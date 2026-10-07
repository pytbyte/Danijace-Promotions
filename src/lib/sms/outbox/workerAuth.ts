const WORKER_HEADER = "x-danijace-sms-worker";

export function isSmsWorkerRequest(request: Request): boolean {
  const configuredToken =
    process.env.SMS_WORKER_TEST_TOKEN?.trim();

  if (!configuredToken) {
    return false;
  }

  const suppliedToken = request.headers
    .get(WORKER_HEADER)
    ?.trim();

  if (!suppliedToken) {
    return false;
  }

  return suppliedToken === configuredToken;
}
