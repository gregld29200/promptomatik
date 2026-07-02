declare module "lamejs" {
  class Mp3Encoder {
    constructor(channels: number, sampleRate: number, kbps: number);
    encodeBuffer(left: Int16Array): Uint8Array;
    flush(): Uint8Array;
  }

  const lamejs: {
    Mp3Encoder: typeof Mp3Encoder;
  };

  export default lamejs;
}

declare module "lamejs/src/js/Lame.js" {
  const Lame: unknown;
  export default Lame;
}

declare module "lamejs/src/js/BitStream.js" {
  const BitStream: unknown;
  export default BitStream;
}

declare module "lamejs/src/js/MPEGMode.js" {
  const MPEGMode: unknown;
  export default MPEGMode;
}
