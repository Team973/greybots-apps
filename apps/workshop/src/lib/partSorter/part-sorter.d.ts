// Types for the Emscripten module built by scripts/build-part-sorter.sh
// (apps/workshop/vision/src/wasm.cpp).
export interface PartSorterModule {
  HEAPU8: Uint8Array;
  _malloc(bytes: number): number;
  _free(pointer: number): void;
  // 0 = bolts, 1 = gears.
  _sorter_init(kind: number): void;
  // mode 0 = scan, 1 = check. Returns a pointer to a JSON string.
  _sorter_run(mode: number, rgba: number, width: number, height: number, fg: number, core: number): number;
  UTF8ToString(pointer: number): string;
}

export default function createPartSorter(options?: { locateFile?: (path: string) => string }): Promise<PartSorterModule>;
