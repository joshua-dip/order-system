import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';

export const CYCLES_COLLECTION = 'exam_cycles';

export type ExamCycleDoc = {
  _id?: ObjectId;
  title: string;
  targetGrade: string;
  totalWeeks: number;
  priceWon: number;
  description: string;
  bulletPoints?: string[];
  startAt?: Date;
  endAt?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type ExamCycleRow = Omit<ExamCycleDoc, '_id'> & { id: string };

function toRow(doc: ExamCycleDoc & { _id: ObjectId }): ExamCycleRow {
  const { _id, ...rest } = doc;
  return { id: _id.toString(), ...rest };
}

export async function listCycles(activeOnly = false): Promise<ExamCycleRow[]> {
  const db = await getDb('gomijoshua');
  const filter = activeOnly ? { isActive: true } : {};
  const docs = await db
    .collection<ExamCycleDoc>(CYCLES_COLLECTION)
    .find(filter)
    .sort({ createdAt: -1 })
    .toArray();
  return docs.map((d) => toRow(d as ExamCycleDoc & { _id: ObjectId }));
}

export async function getCycleById(id: string): Promise<ExamCycleRow | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getDb('gomijoshua');
  const doc = await db.collection<ExamCycleDoc>(CYCLES_COLLECTION).findOne({ _id: new ObjectId(id) });
  if (!doc) return null;
  return toRow(doc as ExamCycleDoc & { _id: ObjectId });
}
