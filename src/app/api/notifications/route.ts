export async function GET() {
  return Response.json(
    {
      success: false,
      error: "Notifications API is not implemented yet.",
    },
    {
      status: 501,
    }
  );
}