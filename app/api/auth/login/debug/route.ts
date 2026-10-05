// TEMPORARY: delete this file after fixing login. Reports names/lengths only, never values.
const NAMES = [
  "AUTH_SESSION_SECRET",
  "ADMIN_USERNAME",
  "ADMIN_PASSWORD",
  "STUDENT_ONE_USERNAME",
  "STUDENT_ONE_PASSWORD",
  "STUDENT_TWO_USERNAME",
  "STUDENT_TWO_PASSWORD",
];

export async function GET() {
  const report = Object.fromEntries(NAMES.map((name) => {
    const value = process.env[name];
    return [name, value === undefined
      ? "MISSING"
      : {
          length: value.length,
          hasLeadingOrTrailingSpace: value !== value.trim(),
          wrappedInQuotes: /^["'].*["']$/.test(value),
        }];
  }));
  return Response.json(report);
}
