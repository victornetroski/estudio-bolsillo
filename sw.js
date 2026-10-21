// 📱 Estudio de bolsillo: the service worker. It keeps the app working without internet and plays the part
// of the PC's server for the studio (the same /api addresses RecordingStudio calls on the PC):
//   /api/studio/sounds          -> the list of instruments and drum kits (sonidos/lista.json)
//   /api/studio/sounds?inst=id  -> where the sprite of an instrument is (?kit=id for a drum kit)
//   /api/studio/save            -> keeps a take in the phone (IndexedDB «bolsillo», store «canciones»)
//   /api/music, /api/files/musica/<file> -> your takes, to use them as backing track
// The app files are saved at install; each sound is saved the first time it is used (or from «Sonidos»).
const VERSION = "1.234.2-1023e974";
const ARCHIVOS = ["index.html","","manifest.webmanifest","icono.svg","icono-192.png","icono-512.png","sonidos/lista.json","assets/c-W7C25JGN.js","assets/c-IA7ZQAEJ.js","assets/c-IUSGFTLD.js","assets/c-3EBWUFF2.js","assets/c-UOMCSRI5.js","assets/c-AQLN2PN3.js","assets/c-VTPA7SF5.js","assets/app-VDDXV7C6.js","assets/c-RLMAEKKR.js","assets/c-SNZ4WKII.js","assets/c-ETOFZS5P.js","assets/c-6SQ7MOX3.js","assets/c-K2QLLM3D.js","assets/c-NA4VLQTT.js","assets/c-Y6GFOTLG.js","assets/c-2BJIGVG4.js","assets/c-CXH5SJEH.js","assets/c-ITYX5VI3.js","assets/c-SPRXIE4O.js","assets/c-SQITHPA3.js","assets/c-YNLAHDOX.js","assets/c-4D7CDWNG.js","assets/c-7RNKWOG7.js","assets/c-HODPCPBI.js","assets/c-HCVOME7Z.js","assets/c-LYYJ2LLH.js","assets/c-FBN3X22I.js","assets/c-FTE4EBLN.js","assets/c-S2MGPOQQ.js","assets/c-6FI56LLS.js","assets/c-SVQDJJYY.js","assets/app-L3K32BNB.css"];
const APP = `app-${VERSION}`;
const SONIDOS = "sonidos-v1";
const BASE = new URL("./", self.location).href;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(ARCHIVOS.map((f) => BASE + f))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("app-") && k !== APP).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// ---------- the songs, in IndexedDB ----------
function db() {
  return new Promise((ok, mal) => {
    const r = indexedDB.open("bolsillo", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("canciones", { keyPath: "file" });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
}
async function tx(modo, fn) {
  const d = await db();
  return new Promise((ok, mal) => {
    const t = d.transaction("canciones", modo);
    const req = fn(t.objectStore("canciones"));
    t.oncomplete = () => ok(req && req.result);
    t.onerror = () => mal(t.error);
  });
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

async function lista() {
  const r = await fetch(BASE + "sonidos/lista.json");
  return r.json();
}

const slug = (s) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "grabacion";

async function api(req, url) {
  const p = url.pathname.replace(/^.*\/api\//, "");
  if (p === "studio/sounds") {
    const l = await lista();
    const inst = url.searchParams.get("inst");
    const kit = url.searchParams.get("kit");
    const conUrl = (s) => ({ ...s, url: BASE + s.url });
    if (inst) {
      const i = l.instruments.find((x) => x.id === inst);
      return i ? json(conUrl(i.sprite)) : json({ error: "Este instrumento no viene en el Estudio de bolsillo." });
    }
    if (kit) {
      const k = l.kits.find((x) => x.id === kit) ?? l.kits[0];
      return json(conUrl(k.sprite));
    }
    return json({
      instruments: l.instruments.map((i) => ({ id: i.id, hidden: false, label: i.label, family: i.family, bank: i.bank, program: i.program })),
      kits: l.kits.map((k) => ({ id: k.id, label: k.label })),
      effects: [],
      lanUrl: null,
      ready: [],
    });
  }
  if (p === "studio/save" && req.method === "POST") {
    const form = await req.formData();
    const audio = form.get("audio");
    if (!audio || audio.size < 1000) return json({ error: "La grabación está vacía." }, 400);
    const title = String(form.get("title") || "").trim() || "Mi grabación";
    const ext = /mp4|aac|m4a/.test(audio.type) ? "m4a" : /ogg/.test(audio.type) ? "ogg" : "webm";
    const file = `grabacion-${slug(title)}-${Date.now()}.${ext}`;
    let notes = [];
    let effects = [];
    try {
      notes = JSON.parse(String(form.get("notes") || "[]"));
      effects = JSON.parse(String(form.get("effects") || "[]"));
    } catch {
      /* the notes are a bonus */
    }
    const blob = new Blob([await audio.arrayBuffer()], { type: audio.type || "audio/webm" });
    await tx("readwrite", (s) => s.put({ file, title, created: Date.now(), type: blob.type, audio: blob, notes, effects }));
    return json({ file });
  }
  if (p === "music") {
    const all = (await tx("readonly", (s) => s.getAll())) || [];
    all.sort((a, b) => b.created - a.created);
    return json({ tracks: all.map((c) => ({ file: c.file, title: c.title })) });
  }
  if (p.startsWith("files/musica/")) {
    const file = decodeURIComponent(p.slice("files/musica/".length));
    const c = await tx("readonly", (s) => s.get(file));
    if (!c) return new Response("", { status: 404 });
    return blobResponse(c.audio, req);
  }
  if (p === "music/instrumentos-ocultos") {
    if (req.method === "POST") return json({ error: "En el celular no se quitan instrumentos; hazlo en la PC." }, 400);
    const l = await lista();
    return json({
      hidden: [],
      favorites: [],
      minVisible: 0,
      families: {},
      instruments: l.instruments.map((i) => ({ id: i.id, label: i.label, family: i.family, roles: "", hidden: false, favorite: false, available: true })),
      freeable: { count: 0, mb: 0 },
    });
  }
  if (p === "metronomo" && req.method === "POST") return json({ error: "En el celular el changuito no se cambia; hazlo en la PC." });
  // Everything else the PC's server does (layouts saved there, the metronome's own poses…): as without
  // connection, which every part of the studio already handles.
  return Response.error();
}

/** Audio for an <audio> element: Android and iPhone ask for pieces (Range), so answer them. */
function blobResponse(blob, req) {
  const range = req.headers.get("Range");
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (!m) return new Response(blob, { headers: { "Content-Type": blob.type, "Content-Length": String(blob.size), "Accept-Ranges": "bytes" } });
  const start = m[1] ? Number(m[1]) : 0;
  const end = m[2] ? Math.min(Number(m[2]), blob.size - 1) : blob.size - 1;
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: { "Content-Type": blob.type, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${blob.size}`, "Accept-Ranges": "bytes" },
  });
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/api/")) {
    e.respondWith(api(e.request, url).catch((err) => json({ error: String(err && err.message ? err.message : err) }, 500)));
    return;
  }
  if (e.request.method !== "GET") return;
  // Sounds: from the phone once saved; the first time from internet, and kept.
  if (url.href.startsWith(BASE + "sonidos/") && !url.pathname.endsWith("lista.json")) {
    e.respondWith(
      caches.open(SONIDOS).then(async (c) => {
        const hit = await c.match(url.href);
        if (hit) return hit;
        const r = await fetch(url.href);
        if (r.ok) await c.put(url.href, r.clone());
        return r;
      }),
    );
    return;
  }
  // The code files have their content in the name (they never change): from the phone.
  if (url.href.startsWith(BASE + "assets/")) {
    e.respondWith(caches.match(url.href).then((hit) => hit || fetch(e.request)));
    return;
  }
  // The page and the list of sounds: internet first (to get updates), the saved copy without internet.
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok && url.href.startsWith(BASE)) {
          const copia = r.clone();
          caches.open(APP).then((c) => c.put(url.pathname.endsWith("/") ? BASE + "index.html" : e.request, copia));
        }
        return r;
      })
      .catch(() => caches.match(url.pathname.endsWith("/") ? BASE + "index.html" : e.request).then((r) => r || caches.match(BASE + "index.html"))),
  );
});
