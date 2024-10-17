const bluetooth = require('node-bluetooth');
const sharp = require('sharp');
const { 
    MAX_CHARS_PER_LINE, 
    LINE_HEIGHT_BITS, 
    GSV0, 
    HEADER, 
    PRINT_FEED, 
    FOOTER 
} = require('./ESCPOS_constants');

// You'll need to implement or import the charset here
const charset = require('./pixel_sans/charset');

class Printer {
    constructor(bluetoothAddress, channel) {
        this.device = new bluetooth.DeviceINQ();
        this.bluetoothAddress = bluetoothAddress;
        this.channel = channel;
        this.connection = null;
    }

    async connect() {
        return new Promise((resolve, reject) => {
            this.device.findSerialPortChannel(this.bluetoothAddress, (channel) => {
                bluetooth.connect(this.bluetoothAddress, channel || this.channel, (err, connection) => {
                    if (err) reject(err);
                    this.connection = connection;
                    resolve();
                });
            });
        });
    }

    close() {
        if (this.connection) {
            this.connection.close();
        }
    }

    _printBytes(bytes) {
        return new Promise((resolve, reject) => {
            this.connection.write(bytes, (err) => {
                if (err) reject(err);
                resolve();
            });
        });
    }

    async printText(text) {
        const newlineSeparatedTextLines = [];
        const newlineSeparatedText = text.split('\n');
        
        for (const newlineChunk of newlineSeparatedText) {
            const words = newlineChunk.split(' ');
            let chunk = '';
            const textLines = [];
            
            for (const word of words) {
                const delimiter = (chunk.length === 0 || chunk.length === MAX_CHARS_PER_LINE) ? '' : ' ';
                if (word.length + chunk.length + delimiter.length > MAX_CHARS_PER_LINE) {
                    // flush the chunk and make a new chunk
                    if (chunk.length !== 0 && chunk.length <= MAX_CHARS_PER_LINE) {
                        textLines.push(chunk);
                        chunk = word;
                    } else {
                        // single word longer than MAX_CHARS_PER_LINE
                        const wordHunks = [];
                        for (let i = 0; i < chunk.length; i += MAX_CHARS_PER_LINE - 1) {
                            wordHunks.push(chunk.slice(i, i + MAX_CHARS_PER_LINE - 1));
                        }
                        for (let i = 0; i < wordHunks.length - 2; i++) {
                            textLines.push(wordHunks[i] + '-');
                        }
                        if (wordHunks[wordHunks.length - 1].length === 1) {
                            textLines.push(wordHunks[wordHunks.length - 2] + wordHunks[wordHunks.length - 1]);
                        } else {
                            textLines.push(wordHunks[wordHunks.length - 2] + '-');
                            chunk = wordHunks[wordHunks.length - 1];
                        }
                        const newDelimiter = (chunk.length === 0 || chunk.length === MAX_CHARS_PER_LINE) ? '' : ' ';
                        if (word.length + chunk.length + newDelimiter.length > MAX_CHARS_PER_LINE) {
                            textLines.push(chunk);
                            chunk = word;
                        } else {
                            chunk = chunk + newDelimiter + word;
                        }
                    }
                } else {
                    chunk = chunk + delimiter + word;
                }
            }
            // flush last chunk
            if (chunk.length <= MAX_CHARS_PER_LINE) {
                textLines.push(chunk);
            } else {
                const wordHunks = [];
                for (let i = 0; i < chunk.length; i += MAX_CHARS_PER_LINE - 1) {
                    wordHunks.push(chunk.slice(i, i + MAX_CHARS_PER_LINE - 1));
                }
                for (let i = 0; i < wordHunks.length - 2; i++) {
                    textLines.push(wordHunks[i] + '-');
                }
                if (wordHunks[wordHunks.length - 1].length === 1) {
                    textLines.push(wordHunks[wordHunks.length - 2] + wordHunks[wordHunks.length - 1]);
                } else {
                    textLines.push(wordHunks[wordHunks.length - 2] + '-');
                    textLines.push(wordHunks[wordHunks.length - 1]);
                }
            }

            newlineSeparatedTextLines.push(textLines);
        }

        const lineDataList = Array(LINE_HEIGHT_BITS).fill(Buffer.alloc(0));

        await this._printBytes(HEADER);
        for (const textLines of newlineSeparatedTextLines) {
            for (const textLine of textLines) {
                const bytesPerLine = textLine.length * 5;
                if (bytesPerLine > MAX_CHARS_PER_LINE * 5) {
                    throw new Error(`Line too long to print; failed to split correctly?\n[${textLine}]`);
                }

                const BLOCK_MARKER = Buffer.concat([
                    GSV0,
                    Buffer.from([bytesPerLine, 0x00, LINE_HEIGHT_BITS, 0x00])
                ]);

                const lineData = lineDataList.map(buffer => Buffer.from(buffer));
                for (const char of textLine) {
                    const charBytesList = charset[char] || charset['CHAR_NOT_FOUND'];
                    charBytesList.forEach((charBytes, index) => {
                        lineData[index] = Buffer.concat([lineData[index], Buffer.from(charBytes)]);
                    });
                }

                await this._printBytes(BLOCK_MARKER);
                for (const bitLine of lineData) {
                    await this._printBytes(bitLine);
                }
            }

            await this._printBytes(PRINT_FEED);
        }

        await this._printBytes(PRINT_FEED);
        await this._printBytes(FOOTER);
    }

    async printCharset() {
        const charString = Object.keys(charset).join('');
        const charStringSplit = [];
        for (let i = 0; i < charString.length; i += MAX_CHARS_PER_LINE) {
            charStringSplit.push(charString.slice(i, i + MAX_CHARS_PER_LINE));
        }
        await this.printText(charStringSplit.join(' '));
    }

    async printImage(imagePath) {
        const image = await sharp(imagePath);
        const metadata = await image.metadata();

        // width 384 dots
        const IMAGE_WIDTH_BYTES = 70;
        const IMAGE_WIDTH_BITS = IMAGE_WIDTH_BYTES * 8;

        let resizedImage = image;
        if (metadata.width > metadata.height) {
            resizedImage = await image.rotate(90);
        }

        resizedImage = await resizedImage.resize({
            width: IMAGE_WIDTH_BITS,
            height: Math.round((metadata.height * IMAGE_WIDTH_BITS) / metadata.width),
            fit: 'fill'
        });

        // black&white printer: dithering
        resizedImage = await resizedImage.threshold();

        const { data, info } = await resizedImage.raw().toBuffer({ resolveWithObject: true });

        await this._printBytes(HEADER);

        for (let startIndex = 0; startIndex < info.height; startIndex += 256) {
            const endIndex = Math.min(startIndex + 256, info.height);
            const lineHeight = endIndex - startIndex;

            const BLOCK_MARKER = Buffer.concat([
                GSV0,
                Buffer.from([IMAGE_WIDTH_BYTES, 0x00, lineHeight - 1, 0x00])
            ]);
            await this._printBytes(BLOCK_MARKER);

            for (let imageLineIndex = 0; imageLineIndex < lineHeight; imageLineIndex++) {
                let imageLine = Buffer.alloc(0);
                for (let byteStart = 0; byteStart < info.width / 8; byteStart++) {
                    let byte = 0;
                    for (let bit = 0; bit < 8; bit++) {
                        const pixelIndex = (imageLineIndex + startIndex) * info.width + byteStart * 8 + bit;
                        if (data[pixelIndex] === 0) {
                            byte |= 1 << (7 - bit);
                        }
                    }
                    // 0x0a breaks the rendering
                    // 0x0a alone is processed like LineFeed by the printer
                    if (byte === 0x0A) {
                        byte = 0x14;
                    }
                    imageLine = Buffer.concat([imageLine, Buffer.from([byte])]);
                }
                await this._printBytes(imageLine);
            }
        }

        await this._printBytes(PRINT_FEED);
        await this._printBytes(PRINT_FEED);
        await this._printBytes(FOOTER);
    }
}

module.exports = Printer;