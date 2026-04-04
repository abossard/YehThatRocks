export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Instrumentation disabled - pre-warming caused server to hang on database queries
    // Re-enable gradually if needed for performance
  }
}
