// 기능 A: 신규 계정 타임아웃
// 멤버가 입장할 때 계정 생성일을 확인해서, 기준(기본 14일) 미만이면 기준 나이가 되는 시각까지 타임아웃합니다.
// 흐름: DM 발송 → 타임아웃 → 로그 (DM이 실패해도 타임아웃은 진행)
const config = require('../config');
const db = require('../db');
const { isWhitelisted } = require('../utils/permissions');
const { runPunishment, dmStep } = require('../utils/punish');
const { buildAccountAgeDM } = require('../utils/dmTemplates');

const DAY_MS = 24 * 60 * 60 * 1000;

async function handleMemberJoin(member, client) {
  if (!db.isFeatureEnabled('accountage')) return;
  if (isWhitelisted(member)) return; // 봇 / 관리자 / 화이트리스트 역할은 제외

  const minDays = config.accountAge.minDays;
  const createdMs = member.user.createdTimestamp;
  const unlockMs = createdMs + minDays * DAY_MS;
  const remainingMs = unlockMs - Date.now();
  if (remainingMs <= 0) return; // 이미 기준 나이 이상

  const createdTs = Math.floor(createdMs / 1000);
  const unlockTs = Math.floor(unlockMs / 1000);

  await runPunishment(client, {
    title: 'New account timeout',
    user: member,
    reason: `Account is younger than ${minDays} days`,
    action: `Timeout until <t:${unlockTs}:F>`,
    fields: [
      { name: 'Account created', value: `<t:${createdTs}:F>\n(<t:${createdTs}:R>)`, inline: true },
      { name: 'Timeout until', value: `<t:${unlockTs}:F>\n(<t:${unlockTs}:R>)`, inline: true },
    ],
    steps: [
      dmStep(member, {
        embeds: [buildAccountAgeDM({ guildName: member.guild.name, unlockTimestamp: unlockTs })],
      }),
      {
        name: 'Apply timeout',
        run: async () => {
          await member.timeout(remainingMs, `New account (younger than ${minDays} days)`);
        },
      },
    ],
  });
}

module.exports = { handleMemberJoin };
