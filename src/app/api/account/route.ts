export async function GET() {
  return Response.json(
    {
      success: false,
      error: "Account API is not implemented yet.",
    },
    {
      status: 501,
    }
  );
}