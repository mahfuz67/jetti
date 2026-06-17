import { YellowstoneStream } from "./yellowstone";

export const startStream = async (): Promise<YellowstoneStream> => {
  const stream = new YellowstoneStream();
  const ready = new Promise<void>((resolve) =>
    stream.once("connect", () => resolve()),
  );
  void stream.start();
  await ready;
  return stream;
};
