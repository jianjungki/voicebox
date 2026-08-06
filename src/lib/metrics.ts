import type { EvaluationSummary, TranscriptSegment } from "../types";

function editDistance(source: string[], target: string[]) {
  const rows = source.length + 1;
  const cols = target.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let row = 0; row < rows; row += 1) matrix[row][0] = row;
  for (let col = 0; col < cols; col += 1) matrix[0][col] = col;

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const substitution = source[row - 1] === target[col - 1] ? 0 : 1;
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + substitution,
      );
    }
  }

  return matrix[rows - 1][cols - 1];
}

function normalizeText(text: string) {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function calculateErrorRates(reference: string, hypothesis: string) {
  const normalizedReference = normalizeText(reference);
  const normalizedHypothesis = normalizeText(hypothesis);
  const referenceWords = normalizedReference.split(" ").filter(Boolean);
  const hypothesisWords = normalizedHypothesis.split(" ").filter(Boolean);
  const referenceChars = [...normalizedReference.replace(/\s/g, "")];
  const hypothesisChars = [...normalizedHypothesis.replace(/\s/g, "")];

  return {
    wer: referenceWords.length
      ? editDistance(referenceWords, hypothesisWords) / referenceWords.length
      : undefined,
    cer: referenceChars.length
      ? editDistance(referenceChars, hypothesisChars) / referenceChars.length
      : undefined,
  };
}

export function summarizeEvaluation(
  segments: TranscriptSegment[],
  durationMs: number,
  reference = "",
): EvaluationSummary {
  const finalSegments = segments.filter((segment) => segment.isFinal);
  const transcript = finalSegments.map((segment) => segment.text).join(" ");
  const totalLatency = finalSegments.reduce((sum, segment) => sum + segment.latencyMs, 0);
  const totalRtf = finalSegments.reduce((sum, segment) => sum + segment.rtf, 0);
  const rates = reference.trim() ? calculateErrorRates(reference, transcript) : {};

  return {
    durationMs,
    averageLatencyMs: finalSegments.length ? totalLatency / finalSegments.length : 0,
    averageRtf: finalSegments.length ? totalRtf / finalSegments.length : 0,
    realtimeRate: finalSegments.length
      ? (finalSegments.filter((segment) => segment.rtf < 1).length / finalSegments.length) * 100
      : 0,
    wordCount: transcript.replace(/\s/g, "").length,
    ...rates,
  };
}

