'use strict';

const express = require('express');
const { db, now } = require('../lib/db');
const { requireLogin } = require('../lib/auth');
const { richHtml, plain } = require('../lib/sanitize');
const u = require('../lib/util');

const router = express.Router();
router.use(requireLogin);

const SURVEYS = {
  basics: {
    title: 'The Basics Survey',
    questions: [
      'Name:', 'Nickname:', 'Birthday:', 'Where do you live:', 'Height:',
      'Eye colour:', 'Hair colour:', 'What are you wearing:', 'What are you listening to:',
      'Last thing you ate:', 'Last person you texted:', 'Last movie you watched:',
      'Do you have a crush:', 'Who is your best friend:', 'What are you scared of:',
      'What is your dream job:', 'Coffee or tea:', 'Cats or dogs:', 'Beach or mountains:',
      'What time is it:',
    ],
  },
  deep: {
    title: 'Deep Thoughts Survey',
    questions: [
      'What is on your mind right now:', 'Best thing that happened this year:',
      'Worst advice you ever took:', 'Something you changed your mind about:',
      'What would you do with a free year:', 'Who do you miss:',
      'What are you avoiding:', 'What are you proud of:', 'What is next:',
    ],
  },
  three: {
    title: 'Three Things',
    questions: [
      'Three things in your bag:', 'Three things in your room:',
      'Three things you want to do before you die:', 'Three people you can tell anything to:',
      'Three songs on repeat:', 'Three things you can\'t live without:',
    ],
  },
};

router.get('/', (req, res) => {
  const fids = u.friendIds(req.user.id);
  const inList = fids.concat(req.user.id).join(',') || '-1';
  const page = Math.max(1, parseInt(req.query.p, 10) || 1);
  const per = 20;
  const all = req.query.all === '1';

  const where = all ? '1=1' : `b.author_id IN (${inList})`;
  const rows = db.prepare(`
    SELECT b.*, a.username, a.display_name, a.avatar FROM bulletins b
    JOIN users a ON a.id = b.author_id
    WHERE ${where}
    ORDER BY b.created_at DESC LIMIT ? OFFSET ?
  `).all(per, (page - 1) * per);
  const total = db.prepare(`SELECT COUNT(*) c FROM bulletins b WHERE ${where}`).get().c;

  res.render('bulletins', { title: 'Bulletin Board', nav: 'bulletins', rows, page, per, total, all });
});

router.get('/compose', (req, res) => {
  const survey = SURVEYS[req.query.survey];
  let body = '';
  let subject = plain(req.query.subject || '', 150);
  if (survey) {
    subject = subject || survey.title;
    body = survey.questions.map((q) => `<b>${q}</b> `).join('<br>');
  }
  res.render('bulletin-compose', {
    title: 'Post Bulletin', nav: 'bulletins', subject, body, surveys: SURVEYS,
  });
});

router.post('/post', (req, res) => {
  const subject = plain(req.body.subject, 150) || '(no subject)';
  const body = richHtml(String(req.body.body || '').slice(0, 40000)).trim();
  if (!body) return res.redirect('/bulletins/compose?err=' + encodeURIComponent('Write something.'));

  const id = db.prepare('INSERT INTO bulletins (author_id, subject, body, created_at) VALUES (?, ?, ?, ?)')
    .run(req.user.id, subject, body, now()).lastInsertRowid;

  for (const fid of u.friendIds(req.user.id)) {
    u.notify(fid, {
      actorId: req.user.id,
      kind: 'bulletin',
      text: `${req.user.display_name} posted a bulletin: ${subject}`,
      url: '/bulletins/' + id,
    });
  }
  res.redirect('/bulletins?msg=' + encodeURIComponent('Bulletin posted to your friends.'));
});

router.get('/:id', (req, res, next) => {
  const b = db.prepare(`
    SELECT b.*, a.username, a.display_name, a.avatar FROM bulletins b
    JOIN users a ON a.id = b.author_id WHERE b.id = ?
  `).get(req.params.id);
  if (!b) return next();
  res.render('bulletin-read', { title: b.subject, nav: 'bulletins', b });
});

router.post('/:id/delete', (req, res) => {
  const b = db.prepare('SELECT * FROM bulletins WHERE id = ?').get(req.params.id);
  if (!b) return res.redirect('/bulletins');
  if (b.author_id !== req.user.id && !req.user.is_admin) return res.status(403).send('Not yours.');
  db.prepare('DELETE FROM bulletins WHERE id = ?').run(b.id);
  res.redirect('/bulletins?msg=' + encodeURIComponent('Bulletin deleted.'));
});

module.exports = router;
