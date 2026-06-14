import fs from "fs";

function patch(file, fn) {
  let s = fs.readFileSync(file, "utf8");
  const before = s;
  s = fn(s);
  fs.writeFileSync(file, s);
  console.log((s === before ? "unchanged" : "patched"), file);
}

/* OnboardingCheck: no repetir términos/formulario si ya decidió */
patch("components/OnboardingCheck.tsx", (s) => {
  s = s.replace(
    /if \(entry\?\.genero && entry\?\.tipo_estudiante\) \{[\s\S]*?setChecked\(true\);\s*return;\s*\}/,
`if (entry?.genero && entry?.tipo_estudiante) {
          setChecked(true);
          return;
        }

        if (entry && (entry.user_agreement === 1 || entry.user_agreement === 0 || entry.user_agreement === true || entry.user_agreement === false)) {
          setChecked(true);
          return;
        }`
  );

  s = s.replace(
    /if \(localDone === 'true'\) \{[\s\S]*?return;\s*\}/,
`if (localDone === 'true') {
          setChecked(true);
          return;
        }`
  );

  return s;
});

/* OnboardingModal: marcar local done al completar */
patch("components/OnboardingModal.tsx", (s) => {
  if (!s.includes("josea_onboarding_done_")) {
    s = s.replace(
      /onComplete\(\);/g,
      `try { localStorage.setItem(\`josea_onboarding_done_\${userId}\`, 'true'); } catch {}
      onComplete();`
    );
  }
  return s;
});

/* Settings: cuando cambia leaderboard, también marcar decisión */
patch("app/settings/page.tsx", (s) => {
  s = s.replace(
    /body: JSON\.stringify\(\{ visible_leaderboard: newVal \}\),/g,
    `body: JSON.stringify({
                        visible_leaderboard: newVal,
                        user_agreement: newVal,
                        user_agreement_date: new Date().toISOString(),
                      }),`
  );
  return s;
});
