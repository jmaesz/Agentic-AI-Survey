# Agentic AI Commuter Survey

A local survey app that asks OpenAI to generate one synthetic answer per agent to a bus waiting-time question and visualizes the aggregate results. It includes count options for 1, 10, 50, 100, and 200 agents, individual response exports, and a results table.

The question is: “Imagine you are a Singaporean commuter taking Bus 96 from Clementi Bus Interchange to and fro NUS. Considering that extreme short waiting times are unrealistic (i.e. 1 min, 2 min) due to practical operational constraints, as well as not too long as you would not want to reach class late, what would you consider a reasonable and comfortable waiting time for the bus?”

**The generated answers are simulated, not responses from real commuters and not representative research.** Each successful agent contributes one OpenAI-generated answer. Requests are sent one at a time, with a default limit of 10 per minute. Temporary API errors are retried with increasing delays until the selected number of successful answers is collected. Permanent errors, such as an invalid API key or exhausted quota, stop the run and are shown in the app. Structured Outputs constrain each answer to the expected JSON shape. ([OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses))

## Run locally

1. Install Node.js 18 or newer.
2. Put your OpenAI API key in the root `.env` file as `OPENAI_API_KEY=your-key-here`. The file is excluded by `.gitignore`.
3. Start the server:

   ```powershell
  node server.js 
   ```

4. Open `http://127.0.0.1:3000`.

The key is read by the local server and is not served to the browser. An operating-system environment variable takes precedence over `.env`. To select another model, set `OPENAI_MODEL` before starting. The default is `gpt-4o-mini`.

To change the request rate, add `OPENAI_REQUESTS_PER_MINUTE=10` to `.env` (or set it in the terminal before starting the server). The app accepts values from 1 to 60 requests per minute.
