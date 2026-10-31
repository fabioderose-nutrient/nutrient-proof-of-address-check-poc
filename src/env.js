// Loads .env from the working directory, if there is one, before the other modules read
// process.env. Import it first.
try {
  process.loadEnvFile();
} catch {
  // no .env file: use the process environment
}
