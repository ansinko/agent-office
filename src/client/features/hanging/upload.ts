// Uploading a picture of your own for the hang dialog: picked from the computer or the phone's
// gallery, dropped on the dialog, or pasted from the clipboard (a screenshot, say).
import { checkUpload } from '../../../shared/wall';

/** Sends a picture to the office (POST /api/wall) and gives back the address it hangs from. */
export async function uploadWallImage(file: Blob): Promise<string> {
  const why = checkUpload(file.type, file.size);
  if (why) throw new Error(why);
  let res: Response;
  try {
    res = await fetch('/api/wall', { method: 'POST', headers: { 'content-type': file.type }, body: file });
  } catch {
    throw new Error("Couldn't reach the office to upload that picture");
  }
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !body.url) throw new Error(body.error ?? `The office couldn't keep that picture (${res.status})`);
  return body.url;
}

/** The first file dropped or pasted: one that isn't a picture is turned away with a reason. */
const fileIn = (data: DataTransfer | null): File | undefined => data?.files?.[0];

/** A file input for the picker: `accept` lets a phone offer its gallery and camera. */
export function filePicker(onFile: (file: File) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.hidden = true;
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    input.value = '';
    if (f) onFile(f);
  });
  return input;
}

/**
 * Takes a picture dropped on `zone` or pasted anywhere while it's open, and marks `zone` while
 * something is dragged over it. Call the result to stop.
 */
export function takeImages(zone: HTMLElement, onFile: (file: File) => void): () => void {
  let depth = 0;
  const mark = (on: boolean) => zone.classList.toggle('dropping', on);
  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
  const enter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    mark(true);
  };
  const over = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
  };
  const leave = () => {
    depth = Math.max(0, depth - 1);
    if (!depth) mark(false);
  };
  const drop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    mark(false);
    const f = fileIn(e.dataTransfer);
    if (f) onFile(f);
  };
  // Text pasted into a field stays text; only a file on the clipboard is taken.
  const paste = (e: ClipboardEvent) => {
    const f = fileIn(e.clipboardData);
    if (!f) return;
    e.preventDefault();
    onFile(f);
  };
  zone.addEventListener('dragenter', enter);
  zone.addEventListener('dragover', over);
  zone.addEventListener('dragleave', leave);
  zone.addEventListener('drop', drop);
  window.addEventListener('paste', paste);
  return () => {
    zone.removeEventListener('dragenter', enter);
    zone.removeEventListener('dragover', over);
    zone.removeEventListener('dragleave', leave);
    zone.removeEventListener('drop', drop);
    window.removeEventListener('paste', paste);
  };
}
