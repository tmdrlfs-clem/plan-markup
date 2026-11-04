import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  maybeSingle: vi.fn(),
  upsert: vi.fn(),
  deleteSelect: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  createSignedUrl: vi.fn(),
  eq: vi.fn(),
  error: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ getAuthUser: m.getAuthUser }));
vi.mock("@/lib/logger", () => ({ logger: { error: m.error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    from: (table: string) => {
      expect(table).toBe("signatures");
      return {
        select: () => ({ eq: (col: string, v: string) => (m.eq(col, v), { maybeSingle: m.maybeSingle }) }),
        upsert: m.upsert,
        delete: () => ({ eq: (col: string, v: string) => (m.eq(col, v), { select: m.deleteSelect }) }),
      };
    },
    storage: {
      from: (bucket: string) => {
        expect(bucket).toBe("signatures");
        return { upload: m.upload, remove: m.remove, createSignedUrl: m.createSignedUrl };
      },
    },
  }),
}));

import { deleteSignature, getSignature, saveSignature } from "./actions";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "a@b.test", name: "A", isPlatformAdmin: false, theme: "blueprint" };

function pngBase64(w: number, h: number): string {
  const b = new Uint8Array(40);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, w);
  v.setUint32(20, h);
  return Buffer.from(b).toString("base64");
}

beforeEach(() => {
  vi.clearAllMocks();
  m.getAuthUser.mockResolvedValue(USER);
  m.maybeSingle.mockResolvedValue({ data: null, error: null });
  m.upsert.mockResolvedValue({ error: null });
  m.upload.mockResolvedValue({ data: {}, error: null });
  m.remove.mockResolvedValue({ data: [], error: null });
  m.createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://x.test/signed" }, error: null });
  m.deleteSelect.mockResolvedValue({ data: [{ storage_path: `${USER.id}/old.png` }], error: null });
});

describe("signature actions (Story 5.13)", () => {
  it("saves a PNG in the user's own folder (the id from the session), then drops the old image", async () => {
    m.maybeSingle.mockResolvedValue({ data: { storage_path: `${USER.id}/old.png` }, error: null });
    await expect(saveSignature({ png: pngBase64(300, 100) })).resolves.toEqual({ ok: true, data: { width: 300, height: 100 } });
    const [path, , options] = m.upload.mock.calls[0];
    expect(path).toMatch(new RegExp(`^${USER.id}/[0-9a-f-]{36}\\.png$`));
    expect(options).toEqual({ contentType: "image/png", upsert: false });
    expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: USER.id, storage_path: path, width: 300, height: 100 }));
    expect(m.remove).toHaveBeenCalledWith([`${USER.id}/old.png`]);
  });

  it("refuses without an active user, and anything not a small PNG, before touching storage", async () => {
    m.getAuthUser.mockResolvedValue(null);
    await expect(saveSignature({ png: pngBase64(10, 10) })).resolves.toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    m.getAuthUser.mockResolvedValue(USER);
    for (const input of [null, "x", { png: "not base64!" }, { png: Buffer.from("<svg/>").toString("base64") }, { png: pngBase64(5000, 10) }]) {
      await expect(saveSignature(input)).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
    expect(m.upload).not.toHaveBeenCalled();
  });

  it("a row that cannot be saved takes its new image back; errors are INTERNAL, logged without details", async () => {
    m.upsert.mockResolvedValue({ error: { code: "42501", message: "permission denied" } });
    await expect(saveSignature({ png: pngBase64(30, 10) })).resolves.toMatchObject({ ok: false, code: "INTERNAL", message: "Something went wrong on our side. Try again shortly." });
    expect(m.remove).toHaveBeenCalledWith([m.upload.mock.calls[0][0]]);
    expect(m.error).toHaveBeenCalledWith("signature.save_failed", expect.anything());
  });

  it("reads the signature by a signed URL of 10 minutes; none: null", async () => {
    await expect(getSignature()).resolves.toEqual({ ok: true, data: null });
    m.maybeSingle.mockResolvedValue({ data: { storage_path: `${USER.id}/a.png`, width: 300, height: 100 }, error: null });
    await expect(getSignature()).resolves.toEqual({ ok: true, data: { url: "https://x.test/signed", width: 300, height: 100 } });
    expect(m.createSignedUrl).toHaveBeenCalledWith(`${USER.id}/a.png`, 600);
    expect(m.eq).toHaveBeenCalledWith("user_id", USER.id);
  });

  it("deletes the row and its image", async () => {
    await expect(deleteSignature()).resolves.toEqual({ ok: true, data: null });
    expect(m.eq).toHaveBeenCalledWith("user_id", USER.id);
    expect(m.remove).toHaveBeenCalledWith([`${USER.id}/old.png`]);
  });
});
