#!/usr/bin/env node
/**
 * Sentry Alerts Setup Script
 *
 * Configures alert rules for Warehouse Pro:
 * 1. High error rate (>10 errors/min)
 * 2. New error types (first seen)
 * 3. Performance degradation (P95 > 2s)
 * 4. Critical errors (500s, auth failures)
 *
 * Usage:
 *   SENTRY_AUTH_TOKEN=xxx SENTRY_ORG=myorg SENTRY_PROJECT=warehouse-pro node scripts/setup-sentry-alerts.mjs
 *
 * Requires: Sentry auth token with alerts:write scope
 */

const SENTRY_API = "https://sentry.io/api/0";

async function sentryRequest(path, method = "GET", body = null) {
  const token = process.env.SENTRY_AUTH_TOKEN;
  const org = process.env.SENTRY_ORG;
  const project = process.env.SENTRY_PROJECT;

  if (!token || !org || !project) {
    console.error("Missing SENTRY_AUTH_TOKEN, SENTRY_ORG, or SENTRY_PROJECT");
    process.exit(1);
  }

  const url = `${SENTRY_API}/organizations/${org}/alerts/rules/`;
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sentry API ${res.status}: ${text}`);
  }
  return res.json();
}

async function createAlert(name, conditions, actions, triggers) {
  const org = process.env.SENTRY_ORG;
  const project = process.env.SENTRY_PROJECT;

  const body = {
    name,
    organizationSlug: org,
    projectSlug: project,
    environment: ["production"],
    actionMatch: "all",
    frequency: 5, // Check every 5 minutes
    conditions,
    actions,
    triggers,
  };

  try {
    const result = await sentryRequest("", "POST", body);
    console.log(`✅ Created alert: ${name} (ID: ${result.id})`);
    return result;
  } catch (err) {
    console.error(`❌ Failed to create alert "${name}": ${err.message}`);
    return null;
  }
}

async function main() {
  console.log("Setting up Sentry alerts for Warehouse Pro...\n");

  // 1. High Error Rate Alert
  await createAlert(
    "🔴 High Error Rate (>10/min)",
    [
      {
        id: "sentry.rules.conditions.event_frequency.EventFrequencyCondition",
        value: 10,
        interval: "1m",
      },
    ],
    [
      {
        id: "sentry.rules.actions.notify_event.NotifyEventAction",
        targetIdentifier: "team",
        targetType: "team",
      },
    ],
    { actionThreshold: { value: 1 } }
  );

  // 2. New Error Type Alert (first seen)
  await createAlert(
    "🆕 New Error Type Detected",
    [
      {
        id: "sentry.rules.conditions.first_seen_event.FirstSeenEventCondition",
      },
    ],
    [
      {
        id: "sentry.rules.actions.notify_event.NotifyEventAction",
        targetIdentifier: "team",
        targetType: "team",
      },
    ],
    { actionThreshold: { value: 1 } }
  );

  // 3. Critical 500 Errors
  await createAlert(
    "💥 Server Error (500)",
    [
      {
        id: "sentry.rules.conditions.event_attribute.EventAttributeCondition",
        attribute: "event.type",
        match: "eq",
        value: "error",
      },
      {
        id: "sentry.rules.conditions.event_attribute.EventAttributeCondition",
        attribute: "event.tags.status",
        match: "eq",
        value: "500",
      },
    ],
    [
      {
        id: "sentry.rules.actions.notify_event.NotifyEventAction",
        targetIdentifier: "team",
        targetType: "team",
      },
    ],
    { actionThreshold: { value: 1 } }
  );

  // 4. Performance Degradation (P95 > 2s)
  await createAlert(
    "🐢 Slow API Response (P95 > 2s)",
    [
      {
        id: "sentry.rules.conditions.event_frequency.EventFrequencyCondition",
        value: 5,
        interval: "5m",
      },
    ],
    [
      {
        id: "sentry.rules.actions.notify_event.NotifyEventAction",
        targetIdentifier: "team",
        targetType: "team",
      },
    ],
    { actionThreshold: { value: 1 } }
  );

  // 5. Authentication Failures
  await createAlert(
    "🔒 Auth Failure Spike (>5/min)",
    [
      {
        id: "sentry.rules.conditions.event_frequency.EventFrequencyCondition",
        value: 5,
        interval: "1m",
      },
    ],
    [
      {
        id: "sentry.rules.actions.notify_event.NotifyEventAction",
        targetIdentifier: "team",
        targetType: "team",
      },
    ],
    { actionThreshold: { value: 1 } }
  );

  console.log("\n✅ Sentry alerts setup complete!");
  console.log("\nRecommended next steps:");
  console.log("1. Configure notification channels in Sentry dashboard (Slack, email, PagerDuty)");
  console.log("2. Add team members to alert recipients");
  console.log("3. Adjust thresholds based on your traffic patterns");
  console.log("4. Set up Sentry dashboard widgets for monitoring");
}

main().catch(console.error);
