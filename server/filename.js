// Multipart filenames may arrive as UTF-8 bytes decoded as Latin-1 by Busboy.
export function readableFilename(name) {
  if ([...name].some(character => character.charCodeAt(0) > 255)) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? name : decoded;
}
