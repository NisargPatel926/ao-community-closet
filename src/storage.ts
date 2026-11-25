// Photo storage: Netlify Blobs in production, a local folder in development.
import { getStore } from "@netlify/blobs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDev } from "./auth.js";

export interface Photo {
  data: ArrayBuffer;
  type: string;
}

interface PhotoStore {
  put(key: string, data: ArrayBuffer, type: string): Promise<void>;
  get(key: string): Promise<Photo | null>;
  del(key: string): Promise<void>;
}

const blobStore = (): PhotoStore => {
  const store = getStore({ name: "photos", consistency: "strong" });
  return {
    async put(key, data, type) {
      await store.set(key, data, { metadata: { type } });
    },
    async get(key) {
      const r = await store.getWithMetadata(key, { type: "arrayBuffer" });
      return r ? { data: r.data, type: String(r.metadata.type || "application/octet-stream") } : null;
    },
    async del(key) {
      await store.delete(key);
    },
  };
};

const folderStore = (dir: string): PhotoStore => ({
  async put(key, data, type) {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, key), Buffer.from(data));
    await writeFile(path.join(dir, key + ".type"), type);
  },
  async get(key) {
    try {
      const buf = await readFile(path.join(dir, key));
      const type = await readFile(path.join(dir, key + ".type"), "utf8");
      return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, type };
    } catch {
      return null;
    }
  },
  async del(key) {
    await unlink(path.join(dir, key)).catch(() => {});
    await unlink(path.join(dir, key + ".type")).catch(() => {});
  },
});

let store: PhotoStore | null = null;
export const photos = (): PhotoStore =>
  (store ??= isDev() ? folderStore(process.env.PHOTO_DIR || ".local-photos") : blobStore());
