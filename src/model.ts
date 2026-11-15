/** Scores edit summaries with the ai-editsummary-model ONNX classifier. */
import * as ort from "onnxruntime-node";

const AUTOCOMMENT = /^\s*\/\*.*?\*\/\s*/;
const MAX_BYTES = 600;
const encoder = new TextEncoder();

/** Pre-processing the model was trained with: drop the /* section *\/ prefix, trim. */
export function normalize(summary: string) {
  return summary.replace(AUTOCOMMENT, "").trim();
}

export function wordCount(summary: string) {
  const s = normalize(summary);
  return s ? s.split(/\s+/).length : 0;
}

/**
 * Down-weight short summaries. AI summaries are usually wordy (median 21
 * words; only 10% have fewer than 10), while short ones like "Added detail and
 * citation." are mostly human even when they use AI-ish phrasing. Each word
 * below `minWords` subtracts `perWord` from the score's log-odds.
 *
 * Held-out test split, flagging at > 0.9 (minWords 10, perWord 1):
 * recall 0.921 → 0.897, false-positive rate 0.66% → 0.08%.
 */
export function lengthAdjusted(score: number, words: number, minWords = 10, perWord = 1) {
  const penalty = perWord * Math.max(0, minWords - words);
  if (!penalty) return score;
  const p = Math.min(Math.max(score, 1e-7), 1 - 1e-7);
  return 1 / (1 + Math.exp(-(Math.log(p / (1 - p)) - penalty)));
}

export class Model {
  private readonly session: ort.InferenceSession;

  private constructor(session: ort.InferenceSession) {
    this.session = session;
  }

  static async load(path: string) {
    return new Model(
      await ort.InferenceSession.create(path, {
        intraOpNumThreads: 1,
        interOpNumThreads: 1,
        executionMode: "sequential",
      }),
    );
  }

  /** P(AI-generated) for each summary. */
  async score(summaries: string[], batchSize = 256): Promise<number[]> {
    const out: number[] = [];
    for (let i = 0; i < summaries.length; i += batchSize) {
      const seqs = summaries.slice(i, i + batchSize).map((s) => encoder.encode(normalize(s)).slice(0, MAX_BYTES));
      const len = Math.max(1, ...seqs.map((b) => b.length));
      const data = new BigInt64Array(seqs.length * len);
      seqs.forEach((b, r) => b.forEach((v, c) => (data[r * len + c] = BigInt(v))));
      const { prob } = await this.session.run({ bytes: new ort.Tensor("int64", data, [seqs.length, len]) });
      out.push(...(prob.data as Float32Array));
    }
    return out;
  }
}
