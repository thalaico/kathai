export function chunkBySentences(text: string, maxWordsPerChunk = 200): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];

  const sentencePattern = /[^.!?]*[.!?]+(?=\s|$)/g;
  const sentences = cleaned.match(sentencePattern) || [cleaned];

  const chunks: string[] = [];
  let currentChunk = '';
  let currentWordCount = 0;

  for (let sentence of sentences) {
    sentence = sentence.trim();
    if (!sentence) continue;

    const wordCount = sentence.split(/\s+/).length;
    if (currentWordCount + wordCount > maxWordsPerChunk && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
      currentWordCount = wordCount;
    } else {
      currentChunk += (currentChunk ? ' ' : '') + sentence;
      currentWordCount += wordCount;
    }
  }

  if (currentChunk.trim()) chunks.push(currentChunk.trim());
  return chunks;
}
