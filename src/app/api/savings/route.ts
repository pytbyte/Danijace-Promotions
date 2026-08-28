export async function GET() {
  return Response.json(
    {
      success: false,
      error: "Savings API is not implemented yet.",
    },
    {
      status: 501,
    }
  );
}