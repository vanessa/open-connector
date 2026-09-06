// Hevy public API docs: https://api.hevyapp.com/docs/

import { adminHeaders, fetchJson, runtimeHeaders } from "./client.ts";

const apiKey = process.env.HEVY_API_KEY;
if (!apiKey) {
  console.log("Set HEVY_API_KEY to run this example.");
  process.exit(0);
}

await fetchJson("http://localhost:3000/api/connections/hevy", {
  method: "PUT",
  headers: adminHeaders({ "content-type": "application/json" }),
  body: JSON.stringify({ authType: "api_key", values: { apiKey } }),
});

const account = await fetchJson("http://localhost:3000/v1/actions/hevy.get_user_info", {
  method: "POST",
  headers: runtimeHeaders({ "content-type": "application/json" }),
  body: JSON.stringify({ input: {} }),
});

const workouts = await fetchJson("http://localhost:3000/v1/actions/hevy.list_workouts", {
  method: "POST",
  headers: runtimeHeaders({ "content-type": "application/json" }),
  body: JSON.stringify({ input: { page: 1, pageSize: 5 } }),
});

console.log(JSON.stringify({ account, workouts }, null, 2));
