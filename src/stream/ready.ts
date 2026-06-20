import { YellowstoneStream } from "./yellowstone";

export const startStream = async (
  stream: YellowstoneStream,
): Promise<YellowstoneStream> => {
  const ready = new Promise<void>((resolve) =>
    stream.once("connect", () => resolve()),
  );
  void stream.start();
  await ready;
  return stream;
};
