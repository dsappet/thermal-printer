// USB HELPER FUNCTION TO BECOME ASYNC
export const getStringDescriptorAsync = (device, descriptorIndex) => {
  return new Promise((resolve, reject) => {
    device.getStringDescriptor(descriptorIndex, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
};
