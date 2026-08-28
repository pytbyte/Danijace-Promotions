export async function GET() {
  return Response.json(
    {
      success: false,
      error: "Loans API is not implemented yet.",
    },
    {
      status: 501,
    }
  );
}