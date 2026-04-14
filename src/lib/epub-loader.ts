import ePub from 'epubjs';

export interface BookMetadata {
  title?: string;
  author?: string;
}

export interface Chapter {
  id: string;
  label: string;
  htmlContent: string;
}

export interface LoadedBook {
  metadata: BookMetadata;
  chapters: Chapter[];
}

export async function loadEPUBFile(file: File): Promise<LoadedBook> {
  const buffer = await file.arrayBuffer();
  return loadEPUBFromBuffer(buffer);
}

export async function loadEPUBFromBuffer(buffer: ArrayBuffer): Promise<LoadedBook> {
  const book = ePub(buffer);
  await book.ready;

  const metadata = await book.loaded.metadata;
  const chapters: Chapter[] = [];

  const spineItems: any[] = (book.spine as any)?.spineItems ?? [];
  let index = 0;
  for (const item of spineItems) {
    try {
      const contents: Document = await item.load(book.load.bind(book));
      const html = new XMLSerializer().serializeToString(contents);
      chapters.push({
        id: item.idref || `chapter-${index}`,
        label: item.label || `Chapter ${index + 1}`,
        htmlContent: html,
      });
      item.unload?.();
    } catch (err) {
      console.warn('Failed to load chapter', item?.idref, err);
    }
    index++;
  }

  return {
    metadata: {
      title: metadata?.title,
      author: metadata?.creator,
    },
    chapters,
  };
}

export function extractPlainText(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  for (const el of div.querySelectorAll('script, style')) el.remove();
  const text = div.textContent || '';
  return text.replace(/\s+/g, ' ').trim();
}
