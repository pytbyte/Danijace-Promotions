type SendPinRecoveryEmailInput = {
  email: string;
  code: string;
};

function getRequiredEnv(
  name: string,
): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}`,
    );
  }

  return value;
}

export async function sendPinRecoveryEmail({
  email,
  code,
}: SendPinRecoveryEmailInput): Promise<void> {
  const apiKey =
    getRequiredEnv("RESEND_API_KEY");

  const from =
    getRequiredEnv("RESEND_FROM_EMAIL");

  const response = await fetch(
    "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject:
          "DANIJACE PROMOTIONS PIN recovery code",
        text: [
          "DANIJACE PROMOTIONS Security",
          "",
          `Your PIN recovery code is: ${code}`,
          "",
          "This code expires in 10 minutes.",
          "It can only be used once.",
          "",
          "If you did not request a PIN reset, you can safely ignore this email.",
        ].join("\n"),
        html: `
          <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
            <h2>DANIJACE PROMOTIONS Security</h2>

            <p>You requested to reset your DANIJACE PROMOTIONS security PIN.</p>

            <p>Your recovery code is:</p>

            <div style="
              font-size:32px;
              font-weight:bold;
              letter-spacing:8px;
              padding:18px;
              background:#f4f4f4;
              text-align:center;
              border-radius:10px;
            ">
              ${code}
            </div>

            <p>
              This code expires in <strong>10 minutes</strong>
              and can only be used once.
            </p>

            <p>
              If you did not request this, you can safely ignore
              this email.
            </p>

            <p>DANIJACE PROMOTIONS</p>
          </div>
        `,
      }),
    },
  );

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(
      "PIN RECOVERY EMAIL ERROR:",
      errorText,
    );

    throw new Error(
      "Unable to send recovery email.",
    );
  }
}