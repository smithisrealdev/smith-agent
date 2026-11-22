// Push notifications to the phone app through Expo's push service, when a job the user started ends.
export function createPush({ store, fetchImpl = fetch, log = console }) {
  return {
    async job(job, r) {
      const tokens = job ? store.pushTokensOf(job.user_id) : []; // no job: the account was deleted while it ran
      if (!tokens.length) return;
      const title = r.ok ? "งานเสร็จแล้ว" : "งานนี้ไม่สำเร็จ ไม่เสียเงิน";
      try {
        const res = await fetchImpl("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(tokens.map((to) => ({ to, title, body: job.title || "", data: { jobId: job.id }, sound: "default" }))),
        });
        const { data = [] } = await res.json();
        data.forEach((t, i) => t.details?.error === "DeviceNotRegistered" && store.dropPushToken(tokens[i])); // the app was removed
      } catch (err) {
        log.error("push failed", err.message);
      }
    },
  };
}
