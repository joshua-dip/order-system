import type { ObjectId } from 'mongodb';
import type { WorkbookGrammarPoint } from './workbook-grammar-types';

export const GENERATED_WORKBOOKS_COLLECTION = 'generated_workbooks';

export type GeneratedWorkbookCategory = '워크북어법';

export type GeneratedWorkbookDoc = {
  _id: ObjectId;
  passage_id: ObjectId;
  textbook: string;
  passage_source_label?: string;
  category: GeneratedWorkbookCategory;
  paragraph: string;
  grammar_points: WorkbookGrammarPoint[];
  answer_text: string;
  explanation: string;
  status: 'draft' | 'reviewed';
  truncated_points_count: number | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  created_by?: string;
  parent_id?: ObjectId;
  legacy_question_id?: ObjectId;
};

export type GeneratedWorkbookInsert = Omit<GeneratedWorkbookDoc, '_id'>;
