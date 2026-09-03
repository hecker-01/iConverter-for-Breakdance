import {
  BlobReader,
  BlobWriter,
  TextReader,
  TextWriter,
  ZipReader,
  ZipWriter,
} from '@zip.js/zip.js';

export class ArchiveError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'ArchiveError';
    this.code = code;
  }
}

function normalizeRelativeName(name) {
  return String(name).replace(/\\/g, '/').replace(/^\.\//, '');
}

export async function expandInputs(files) {
  const svgItems = [];
  const errors = [];

  const addSvg = (item) => {
    svgItems.push(item);
  };

  for (const file of files) {
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.svg')) {
      addSvg({
        name: file.name,
        relativeName: file.name,
        size: file.size,
        readText: () => file.text(),
        source: file,
      });
      continue;
    }

    if (!lowerName.endsWith('.zip')) {
      errors.push({ name: file.name, code: 'unsupportedFile' });
      continue;
    }

    let reader;
    try {
      reader = new ZipReader(new BlobReader(file), {
        strictness: 'strict',
        filenameValidation: 'strict',
        checkCrc32: true,
        checkOverlappingEntry: true,
      });
      const entries = await reader.getEntries();
      const filesInArchive = entries.filter((entry) => !entry.directory);

      if (filesInArchive.some((entry) => entry.encrypted)) {
        throw new ArchiveError('encryptedArchive');
      }
      if (filesInArchive.some((entry) => entry.filename.toLowerCase().endsWith('.zip'))) {
        throw new ArchiveError('nestedArchive');
      }

      const svgEntries = filesInArchive.filter((entry) => entry.filename.toLowerCase().endsWith('.svg'));
      if (!svgEntries.length) throw new ArchiveError('emptyArchive');

      const extracted = [];
      for (const entry of svgEntries) {
        const relativeName = normalizeRelativeName(entry.filename);
        const text = await entry.getData(new TextWriter());
        extracted.push({
          name: relativeName.split('/').pop(),
          relativeName,
          size: entry.uncompressedSize,
          readText: async () => text,
          source: file,
        });
      }
      extracted.forEach(addSvg);
    } catch (error) {
      errors.push({
        name: file.name,
        code: error instanceof ArchiveError ? error.code : 'unsafeArchive',
      });
    } finally {
      if (reader) await reader.close().catch(() => {});
    }
  }

  return { svgItems, errors };
}

export async function createDownloadZip(items) {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  for (const item of items) {
    await writer.add(item.outputName.relativeName, new TextReader(item.output));
  }
  return writer.close();
}
