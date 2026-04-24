export function getStudentAiConfig() {
  return {
    dailyLimit: parseInt(process.env.STUDENT_AI_DAILY_LIMIT ?? '5', 10),
    weeklyLimit: parseInt(process.env.STUDENT_AI_WEEKLY_LIMIT ?? '25', 10),
  };
}
