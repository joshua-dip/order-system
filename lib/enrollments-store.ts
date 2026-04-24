import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';

export const ENROLLMENTS_COLLECTION = 'enrollments';

export type EnrollmentStatus = 'pending_payment' | 'active' | 'completed' | 'cancelled' | 'refunded';

export type EnrollmentDoc = {
  _id?: ObjectId;
  studentLoginId: string;
  cycleId: ObjectId;
  cycleSnapshot: {
    title: string;
    targetGrade: string;
    totalWeeks: number;
    priceWon: number;
  };
  status: EnrollmentStatus;
  paymentMethod: 'manual';
  depositorName?: string;
  appliedAt: Date;
  paidAt?: Date;
  activatedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  cancelReason?: string;
  currentWeek?: number;
  adminMemo?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type EnrollmentRow = Omit<EnrollmentDoc, '_id' | 'cycleId'> & {
  id: string;
  cycleId: string;
};

function toRow(doc: EnrollmentDoc & { _id: ObjectId }): EnrollmentRow {
  const { _id, cycleId, ...rest } = doc;
  return { id: _id.toString(), cycleId: cycleId.toString(), ...rest };
}

export async function getActiveEnrollment(studentLoginId: string): Promise<EnrollmentRow | null> {
  const db = await getDb('gomijoshua');
  const doc = await db
    .collection<EnrollmentDoc>(ENROLLMENTS_COLLECTION)
    .findOne({ studentLoginId, status: { $in: ['active', 'pending_payment'] } });
  if (!doc) return null;
  return toRow(doc as EnrollmentDoc & { _id: ObjectId });
}

export async function listEnrollmentsByStudent(studentLoginId: string): Promise<EnrollmentRow[]> {
  const db = await getDb('gomijoshua');
  const docs = await db
    .collection<EnrollmentDoc>(ENROLLMENTS_COLLECTION)
    .find({ studentLoginId })
    .sort({ appliedAt: -1 })
    .toArray();
  return docs.map((d) => toRow(d as EnrollmentDoc & { _id: ObjectId }));
}
