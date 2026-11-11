#!/usr/bin/env node
// Command-line account tools. The password is read from a prompt or from
// standard input, never from an argument, so it stays out of shell history.
//
//   node scripts/auth-tool.js seed
//       Write config/admin-seed.json: the scrypt hash a new data directory
//       gives the built-in admin. Gitignored; never commit it.
//
//   node scripts/auth-tool.js reset <email>
//       Set a user's password (for example a locked-out admin), then restart
//       the server. They must choose a new one at next login.
const fs = require('fs');
const path = require('path');
const auth = require('../auth');

function readPassword() {
  if (!process.stdin.isTTY) {
    return Promise.resolve(fs.readFileSync(0, 'utf8').replace(/\r?\n$/, ''));
  }
  process.stdout.write('Password: ');
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  return new Promise((resolve) => {
    let value = '';
    process.stdin.on('data', (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write('\n');
          return resolve(value);
        }
        if (ch === '\u0003') process.exit(130);
        if (ch === '\u007f') value = value.slice(0, -1);
        else value += ch;
      }
    });
  });
}

async function main() {
  const [command, email] = process.argv.slice(2);
  if (command !== 'seed' && !(command === 'reset' && email)) {
    console.error('Usage: auth-tool.js seed | auth-tool.js reset <email>');
    process.exit(2);
  }
  const password = await readPassword();
  const problem = auth.passwordProblem(password, email ? auth.normalizeEmail(email) : auth.ADMIN_EMAIL);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  if (command === 'seed') {
    const file = path.join(__dirname, '..', 'config', 'admin-seed.json');
    fs.writeFileSync(file, JSON.stringify({ passwordHash: auth.hashPasswordSync(password) }, null, 2) + '\n', { mode: 0o600 });
    console.log(`Wrote ${file}`);
    return;
  }
  if (!auth.resetPasswordOnDisk(email, password)) {
    console.error(`No user ${email}`);
    process.exit(1);
  }
  console.log(`Password updated for ${email}. Restart the server to apply it.`);
}

main();
