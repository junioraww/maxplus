export const VIDEO_EXTENSIONS = ["mp4", "mov", "webm", "mkv", "avi", "m4v", "3gp", "ts"];
export const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "heif", "svg"];
export const AUDIO_EXTENSIONS = ["mp3", "ogg", "wav", "m4a", "aac", "flac", "opus"];

export function getFileExtension(nameOrPath) {
  if (!nameOrPath || typeof nameOrPath !== "string") return "";
  const clean = nameOrPath.split("?")[0].split("#")[0];
  const parts = clean.split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

export function detectMediaType(source) {
  if (!source) {
    return { isVideo: false, isGif: false, isPhoto: false, isAudio: false, extension: "", name: "" };
  }

  if (typeof source === "string") {
    const ext = getFileExtension(source);
    const isGif = ext === "gif";
    const isVideo = VIDEO_EXTENSIONS.includes(ext) || isGif;
    const isAudio = AUDIO_EXTENSIONS.includes(ext);
    const isPhoto = !isVideo && !isAudio && (IMAGE_EXTENSIONS.includes(ext) || ext === "");
    const name = source.split("/").pop().split("\\").pop() || "";
    return { isVideo, isGif, isPhoto, isAudio, extension: ext, name };
  }

  if (source instanceof File || source instanceof Blob) {
    const name = source.name || "";
    const ext = getFileExtension(name);
    const mime = (source.type || "").toLowerCase();
    const isGif = mime === "image/gif" || ext === "gif";
    const isVideo = mime.startsWith("video/") || VIDEO_EXTENSIONS.includes(ext) || isGif;
    const isAudio = mime.startsWith("audio/") || AUDIO_EXTENSIONS.includes(ext);
    const isPhoto = !isVideo && !isAudio && (mime.startsWith("image/") || IMAGE_EXTENSIONS.includes(ext) || ext === "");
    return { isVideo, isGif, isPhoto, isAudio, extension: ext, name };
  }

  const path = source.path || source.localPath || source.uri || source.url || source.baseUrl || "";
  const name = source.name || path.split("/").pop().split("\\").pop() || "";
  const ext = getFileExtension(name) || getFileExtension(path);
  const mime = (source.mime || source.mime_type || "").toLowerCase();
  const rawType = (source.type || source._type || "").toUpperCase();

  const isGif = mime === "image/gif" || ext === "gif";
  const isVideo = rawType === "VIDEO" || mime.startsWith("video/") || VIDEO_EXTENSIONS.includes(ext) || isGif;
  const isAudio = rawType === "AUDIO" || mime.startsWith("audio/") || AUDIO_EXTENSIONS.includes(ext);
  const isPhoto = rawType === "PHOTO" || (!isVideo && !isAudio && (mime.startsWith("image/") || IMAGE_EXTENSIONS.includes(ext) || (!mime && !ext)));

  return { isVideo, isGif, isPhoto, isAudio, extension: ext, name };
}

export function getAttachType(source) {
  const meta = detectMediaType(source);
  if (meta.isVideo) return "VIDEO";
  if (meta.isAudio) return "AUDIO";
  if (meta.isPhoto) return "PHOTO";
  return "FILE";
}

export function extractMediaSource(fileOrPath) {
  if (!fileOrPath) return null;
  const isStr = typeof fileOrPath === "string";
  const path = isStr ? fileOrPath : fileOrPath.path || null;
  const blob = isStr ? null : (fileOrPath instanceof Blob ? fileOrPath : fileOrPath.blob || null);
  const meta = detectMediaType(fileOrPath);

  return {
    path,
    blob,
    name: meta.name,
    extension: meta.extension,
    isVideo: meta.isVideo,
    isGif: meta.isGif,
    mediaType: meta.isVideo ? "video" : "photo"
  };
}
