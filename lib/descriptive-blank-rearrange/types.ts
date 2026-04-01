export type BlankRearrangementProblem = {
  original_text: string;
  passage_with_blank: string;
  word_box: string;
  answer_phrase: string;
  chunks: string[];
  points: number;
  blank_label: string;
  explanation: string;
  word_box_other?: string;
  blank_label_other?: string;
};

export type PhraseChunks = { phrase: string; chunks: string[] };
