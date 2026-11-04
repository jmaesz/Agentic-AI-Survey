# Agentic AI Commuter Survey

A local survey app that generates synthetic answers about acceptable Bus 96 waiting times and visualizes the results. Choose 1, 10, 50, 100, or 200 hypothetical agents for a run.

## Travel period options

Choose one travel period before starting a survey. Each agent answers the waiting-time question for the selected period.

| Option | Scenario |
| --- | --- |
| Off-peak | Travel between Clementi Bus Interchange and NUS outside the morning and evening peak periods. |
| AM peak | Travel from Clementi Bus Interchange to NUS during the morning peak, with class or work arrival time in mind. |
| PM peak | Travel from NUS to Clementi Bus Interchange during the evening peak, on the way home. |

The survey asks for the longest bus waiting time the hypothetical commuter would consider comfortable and acceptable. Answers are whole numbers from 3 to 20 minutes. The selected period is included with each answer in the results table and downloaded CSV or JSON.

**Generated answers are simulated. They are not responses from real commuters and are not representative research.** Each successful agent contributes one OpenAI-generated answer. Requests are sent one at a time, with a default limit of 10 per minute. Temporary API errors are retried with increasing delays. Permanent errors, such as an invalid API key or exhausted quota, stop the run and are shown in the app. Structured Outputs constrain each answer to the expected JSON shape. ([OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses))

## Run locally

1. Install Node.js 18 or newer.
2. Put your OpenAI API key in the root `.env` file as `OPENAI_API_KEY=your-key-here`. The file is excluded by `.gitignore`.
3. Start the server:

   ```powershell
   node server.js
   ```

4. Open `http://127.0.0.1:3000`.

The key is read by the local server and is not served to the browser. An operating-system environment variable takes precedence over `.env`. To select another model, set `OPENAI_MODEL` before starting. The default is `gpt-4o-mini`.

To change the request rate, add `OPENAI_REQUESTS_PER_MINUTE=10` to `.env` or set it in the terminal before starting the server. The app accepts values from 1 to 60 requests per minute.
