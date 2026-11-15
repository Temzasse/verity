// "Spot the technique": a short quiz in the "What it detects" section. Each round shows a sentence,
// the reader picks the technique (or "Nothing to flag"), and the answer explains the technique, marks
// the words that give it away and shows a neutral rewrite. Neutral sentences are mixed in on purpose:
// spotting manipulation includes not flagging honest writing.

const CATEGORY_COLORS = {
  propaganda: '#dc2626',
  'logical-fallacy': '#7c3aed',
  'loaded-language': '#db2777',
  'unsupported-claim': '#ca8a04',
  'missing-context': '#0891b2',
};
const CATEGORY_LABELS = {
  propaganda: 'Propaganda',
  'logical-fallacy': 'Logical fallacy',
  'loaded-language': 'Loaded language',
  'unsupported-claim': 'Unsupported claim',
  'missing-context': 'Missing context',
};

// Same ids, labels and definitions as TECHNIQUES in utils/analysis.ts (what the analysis can flag).
const TECHNIQUES = {
  'name-calling': ['Name calling', 'propaganda', 'Labelling a person or group with a loaded term instead of engaging with what they say or do.'],
  'appeal-to-fear': ['Appeal to fear', 'propaganda', 'Stirring up fear of harm, loss or danger to push a conclusion instead of giving evidence.'],
  'flag-waving': ['Flag-waving', 'propaganda', 'Appealing to national, group or "ordinary people" identity to justify a position.'],
  'casting-doubt': ['Casting doubt', 'propaganda', "Undermining someone's credibility or motives without evidence."],
  bandwagon: ['Bandwagon', 'propaganda', 'Claiming that everyone already believes or does something, so the reader should too.'],
  exaggeration: ['Exaggeration', 'propaganda', 'Making something seem much bigger, worse or smaller than the facts support.'],
  slogans: ['Slogans and clichés', 'propaganda', 'Short catchy phrases or stock lines that replace argument and discourage further thought.'],
  'loaded-language': ['Loaded language', 'loaded-language', 'Emotionally charged words about events or actions where neutral wording was available.'],
  whataboutism: ['Whataboutism', 'logical-fallacy', "Deflecting criticism by pointing to someone else's wrongdoing instead of answering it."],
  'straw-man': ['Straw man', 'logical-fallacy', "Misrepresenting an opponent's position as something weaker or more extreme, then attacking that."],
  'false-dilemma': ['False dilemma', 'logical-fallacy', 'Presenting only two options when more exist.'],
  'causal-oversimplification': ['Causal oversimplification', 'logical-fallacy', 'Blaming a complex outcome on a single cause.'],
  'slippery-slope': ['Slippery slope', 'logical-fallacy', 'Claiming one step will inevitably lead to an extreme outcome, without showing why.'],
  'red-herring': ['Red herring', 'logical-fallacy', 'Bringing in an irrelevant point to distract from the issue.'],
  'unnamed-authority': ['Unnamed authority', 'unsupported-claim', 'Leaning on vague sources such as "experts say" or "studies show" without naming them.'],
  'unsourced-claim': ['Unsourced claim', 'unsupported-claim', 'A specific fact, number, event or cause stated as true with no source or evidence.'],
  'cherry-picking': ['Cherry-picking', 'missing-context', 'Choosing only the facts or figures that support a point and leaving out ones that do not.'],
  'misleading-framing': ['Misleading framing', 'missing-context', 'Technically true, but presented without the baseline, comparison or context needed to judge it.'],
};

const NONE = 'none';

/** text, the giveaway words (`mark`, a substring of text), the answer, why, and a neutral rewrite. */
const QUESTIONS = [
  {
    text: 'The so-called experts behind this report are nothing but a gang of paid alarmists.',
    mark: 'a gang of paid alarmists',
    answer: 'name-calling',
    why: "The sentence attacks the authors with a label and never says what's wrong with the report.",
    neutral: "The report's authors, whose work was funded by an advocacy group, predict sharp temperature rises.",
  },
  {
    text: 'If this bill passes, no family in this country will be safe in their own home.',
    mark: 'no family in this country will be safe in their own home',
    answer: 'appeal-to-fear',
    why: 'It aims to frighten the reader instead of showing what the bill changes or how big the risk is.',
    neutral: 'Critics say the bill would loosen some rules on home security checks.',
  },
  {
    text: 'Any true patriot knows that buying imported cars is a betrayal of our nation.',
    mark: 'Any true patriot knows',
    answer: 'flag-waving',
    why: 'Loyalty to the nation stands in for an argument, and disagreeing is framed as betrayal.',
    neutral: 'Some argue that buying domestically made cars supports local jobs.',
  },
  {
    text: "The minister's sudden concern for the environment comes, of course, just weeks before an election.",
    mark: 'sudden concern',
    answer: 'casting-doubt',
    why: 'It hints at a hidden motive without evidence, inviting you to dismiss the plan without looking at it.',
    neutral: 'The minister announced the environmental plan on Tuesday, six weeks before the election.',
  },
  {
    text: "Millions of smart shoppers have already switched. Don't be the last one left behind.",
    mark: 'Millions of smart shoppers have already switched',
    answer: 'bandwagon',
    why: "Popularity is offered as the reason to switch, not anything about the product itself.",
    neutral: 'The company says it gained two million customers this year.',
  },
  {
    text: 'The new parking fee will completely destroy the city centre.',
    mark: 'completely destroy',
    answer: 'exaggeration',
    why: 'A modest fee is blown up into total ruin, far beyond what the facts could support.',
    neutral: 'Shop owners worry the new parking fee could reduce the number of visitors to the city centre.',
  },
  {
    text: 'Enough is enough. It is time to take back control.',
    mark: 'take back control',
    answer: 'slogans',
    why: "A catchy stock phrase replaces the argument: control of what, from whom, and why it'd be better?",
    neutral: 'The group wants the city, not the national government, to set local housing rules.',
  },
  {
    text: 'The council rammed through its shameless tax grab late on Friday night.',
    mark: 'rammed through its shameless tax grab',
    answer: 'loaded-language',
    why: '"Rammed through" and "shameless tax grab" tell you how to feel before you know what happened.',
    neutral: 'The council approved a tax increase on Friday evening.',
  },
  {
    text: 'Why are reporters asking about our budget overruns when the last government wasted far more?',
    mark: 'when the last government wasted far more',
    answer: 'whataboutism',
    why: "Pointing at someone else's spending dodges the question that was actually asked.",
    neutral: 'Asked about the budget overruns, the spokesperson said construction costs had risen 20%.',
  },
  {
    text: 'My opponent wants to move some police funding to mental health services, which means she wants criminals to rule our streets.',
    mark: 'which means she wants criminals to rule our streets',
    answer: 'straw-man',
    why: 'A specific budget proposal is twisted into an extreme position nobody holds, which is then easy to attack.',
    neutral: 'My opponent wants to move part of the police budget to mental health services; I think that would slow response times.',
  },
  {
    text: 'Either we build the new highway, or this town dies.',
    mark: 'Either we build the new highway, or this town dies',
    answer: 'false-dilemma',
    why: 'Only two outcomes are offered, while rail links, other roads or doing nothing differently all exist.',
    neutral: 'Supporters say the highway would bring business; others propose improving the rail link instead.',
  },
  {
    text: 'Crime rose last year, and the reason is obvious: the new mayor.',
    mark: 'the reason is obvious: the new mayor',
    answer: 'causal-oversimplification',
    why: 'Crime has many causes, like the economy, policing and reporting changes; one person is blamed for all of it.',
    neutral: 'Crime rose 4% last year; researchers point to several factors, including rising unemployment.',
  },
  {
    text: 'If we let students use calculators in exams, soon nobody will be able to think for themselves.',
    mark: 'soon nobody will be able to think for themselves',
    answer: 'slippery-slope',
    why: 'A small step is claimed to lead inevitably to an extreme result, with nothing showing how.',
    neutral: 'Some teachers worry that calculators in exams could weaken students’ mental arithmetic.',
  },
  {
    text: "Asked about the factory's pollution, the CEO spoke at length about the local sports teams the company sponsors.",
    mark: 'spoke at length about the local sports teams the company sponsors',
    answer: 'red-herring',
    why: 'The sponsorship may be true, but it has nothing to do with the pollution question.',
    neutral: "Asked about the factory's pollution, the CEO said new filters would be installed next year.",
  },
  {
    text: 'Experts agree that the supplement noticeably improves memory.',
    mark: 'Experts agree',
    answer: 'unnamed-authority',
    why: 'Which experts? Without names or studies, there is no way to check the claim or who is behind it.',
    neutral: 'A 2024 study of 60 adults found a small memory improvement; two larger studies found none.',
  },
  {
    text: 'Seventy percent of teenagers now spend more than eight hours a day on their phones.',
    mark: 'Seventy percent of teenagers now spend more than eight hours a day',
    answer: 'unsourced-claim',
    why: "A precise number is stated as fact with no source. It might even be true, but the reader can't check it.",
    neutral: 'A 2025 national survey of 3,000 teenagers found that 30% use their phones for more than five hours a day.',
  },
  {
    text: 'Sales of electric bikes doubled in March, proving the market is booming.',
    mark: 'doubled in March',
    answer: 'cherry-picking',
    why: "One strong month is picked out; it doesn't say how the rest of the year went.",
    neutral: 'Electric bike sales doubled in March after a slow winter, but are flat for the year so far.',
  },
  {
    text: 'The new drug cuts the risk of the disease in half.',
    mark: 'cuts the risk of the disease in half',
    answer: 'misleading-framing',
    why: 'True, but without the baseline: going from 2 in 10,000 to 1 in 10,000 sounds far less dramatic.',
    neutral: 'In the trial, the drug lowered the risk of the disease from 2 in 10,000 people to 1 in 10,000.',
  },
  {
    text: 'The city council voted 7–2 on Tuesday to extend library opening hours, starting in March.',
    answer: NONE,
    why: 'A specific, checkable event in neutral words. Nothing here pushes you toward a feeling or conclusion.',
  },
  {
    text: 'Critics say the plan will push up rents, while supporters say it will add 2,000 homes.',
    answer: NONE,
    why: 'Both sides are attributed and presented in neutral terms. Reporting a disagreement is not manipulation.',
  },
  {
    text: 'In my view, the new stadium is a poor use of public money, because the city still has a shortage of schools.',
    answer: NONE,
    why: 'A clearly labelled opinion with a reason given. Verity flags how something is argued, not which side it takes.',
  },
];

const ROUNDS = 8;
const NEUTRAL_ROUNDS = 2;

const el = (tag, className, children) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (children != null) node.append(...[children].flat());
  return node;
};
const shuffle = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const labelOf = (id) => (id === NONE ? 'Nothing to flag' : TECHNIQUES[id][0]);
const colorOf = (id) => (id === NONE ? '#16a34a' : CATEGORY_COLORS[TECHNIQUES[id][1]]);

/** Three technique options (the answer plus a near miss from the same category when there is one) and "Nothing to flag". */
function optionsFor(question) {
  const ids = Object.keys(TECHNIQUES);
  if (question.answer === NONE) return [...shuffle(ids).slice(0, 3), NONE];
  const category = TECHNIQUES[question.answer][1];
  const near = shuffle(ids.filter((id) => id !== question.answer && TECHNIQUES[id][1] === category)).slice(0, 1);
  const far = shuffle(ids.filter((id) => id !== question.answer && !near.includes(id) && TECHNIQUES[id][1] !== category));
  const others = [...near, ...far].slice(0, 2);
  return [...shuffle([question.answer, ...others]), NONE];
}

function newGame() {
  const manipulative = shuffle(QUESTIONS.filter((q) => q.answer !== NONE)).slice(0, ROUNDS - NEUTRAL_ROUNDS);
  const neutral = shuffle(QUESTIONS.filter((q) => q.answer === NONE)).slice(0, NEUTRAL_ROUNDS);
  return { rounds: shuffle([...manipulative, ...neutral]).map((q) => ({ q, options: optionsFor(q), picked: null })), index: 0 };
}

/** The sentence, with the giveaway words marked once the answer is revealed. */
function sentence(question, revealed) {
  const quote = el('blockquote', 'quiz-sentence');
  const at = revealed && question.mark ? question.text.indexOf(question.mark) : -1;
  if (at < 0) {
    quote.textContent = question.text;
    return quote;
  }
  const mark = el('mark', 'quiz-mark', question.mark);
  mark.style.setProperty('--cat', colorOf(question.answer));
  quote.append(question.text.slice(0, at), mark, question.text.slice(at + question.mark.length));
  return quote;
}

function explanation(round) {
  const { q, picked } = round;
  const correct = picked === q.answer;
  const box = el('div', `quiz-explain ${correct ? 'is-correct' : 'is-wrong'}`);
  box.append(
    el('p', 'quiz-verdict', correct ? 'Correct!' : q.answer === NONE ? 'Not quite. Nothing here needs flagging.' : `Not quite. It's ${labelOf(q.answer)}.`),
  );
  if (q.answer !== NONE) {
    const [label, category, definition] = TECHNIQUES[q.answer];
    const chip = el('span', 'chip', CATEGORY_LABELS[category]);
    chip.style.setProperty('--cat', CATEGORY_COLORS[category]);
    box.append(el('div', 'quiz-technique', [el('strong', null, label), chip]), el('p', 'quiz-def', definition));
  }
  box.append(el('p', 'quiz-why', q.why));
  if (q.neutral) box.append(el('div', 'quiz-neutral', [el('span', 'quiz-neutral-label', 'A neutral version'), el('p', null, q.neutral)]));
  return box;
}

function verdictFor(score) {
  if (score === ROUNDS) return ['A sharp eye.', 'You caught every technique and left the honest sentences alone.'];
  if (score >= ROUNDS - 2) return ['Hard to fool.', 'You spotted most of them. The ones you missed are listed below.'];
  if (score >= ROUNDS / 2 - 1) return ['Getting there.', 'Some of these are subtle on purpose. Look over the ones you missed.'];
  return ['Manipulation works on everyone.', "That's exactly why Verity points it out while you read."];
}

function initQuiz(root) {
  let game = newGame();
  const live = el('p', 'visually-hidden');
  live.setAttribute('aria-live', 'polite');

  const render = () => {
    const done = game.index >= game.rounds.length;
    const score = game.rounds.filter((r) => r.picked != null && r.picked === r.q.answer).length;
    root.replaceChildren(done ? summary(score) : roundView(game.rounds[game.index], score), live);
  };

  const progress = (score) => {
    const dots = el(
      'div',
      'quiz-dots',
      game.rounds.map((r, i) => {
        const state = r.picked == null ? (i === game.index ? 'is-current' : '') : r.picked === r.q.answer ? 'is-right' : 'is-missed';
        return el('span', `quiz-dot ${state}`);
      }),
    );
    dots.setAttribute('aria-hidden', 'true');
    return el('div', 'quiz-head', [
      el('span', 'quiz-count', `Sentence ${Math.min(game.index + 1, game.rounds.length)} of ${game.rounds.length}`),
      dots,
      el('span', 'quiz-score', `${score} correct`),
    ]);
  };

  const roundView = (round, score) => {
    const answered = round.picked != null;
    const card = el('div', 'quiz-card');
    const options = el(
      'div',
      'quiz-options',
      round.options.map((id) => {
        const state = !answered ? '' : id === round.q.answer ? 'is-answer' : id === round.picked ? 'is-picked' : 'is-dim';
        const button = el('button', `quiz-option ${state}${id === NONE ? ' is-none' : ''}`, labelOf(id));
        button.type = 'button';
        button.disabled = answered;
        button.addEventListener('click', () => {
          round.picked = id;
          live.textContent = id === round.q.answer ? 'Correct.' : `The answer is ${labelOf(round.q.answer)}.`;
          render();
          root.querySelector('.quiz-next')?.focus({ preventScroll: true });
        });
        return button;
      }),
    );
    card.append(progress(score), sentence(round.q, answered), el('p', 'quiz-prompt', answered ? 'The answer' : 'Which technique is this sentence using?'), options);
    if (answered) {
      const last = game.index === game.rounds.length - 1;
      const next = el('button', 'button button-primary quiz-next', last ? 'See your score' : 'Next sentence');
      next.type = 'button';
      next.addEventListener('click', () => {
        game.index++;
        render();
        root.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
      card.append(explanation(round), next);
    }
    return card;
  };

  const summary = (score) => {
    const [title, text] = verdictFor(score);
    const missed = game.rounds.filter((r) => r.picked !== r.q.answer);
    const card = el('div', 'quiz-card quiz-summary');
    card.append(
      progress(score),
      el('p', 'quiz-final', [el('span', 'quiz-final-score', `${score}/${game.rounds.length}`), el('span', 'quiz-final-title', title)]),
      el('p', 'quiz-final-text', text),
    );
    if (missed.length) {
      card.append(
        el(
          'ul',
          'quiz-missed',
          missed.map(({ q, picked }) => {
            const item = el('li');
            const name = el('span', 'quiz-missed-name', labelOf(q.answer));
            name.style.setProperty('--cat', colorOf(q.answer));
            item.append(
              name,
              el('span', 'quiz-missed-text', `“${q.text}”`),
              el('span', 'quiz-missed-note', `You picked ${labelOf(picked)}. ${q.answer === NONE ? q.why : TECHNIQUES[q.answer][2]}`),
            );
            return item;
          }),
        ),
      );
    }
    const again = el('button', 'button button-secondary', 'Play again');
    again.type = 'button';
    again.addEventListener('click', () => {
      game = newGame();
      render();
    });
    const install = el('a', 'button button-primary', 'Get Verity');
    install.href = '#install';
    card.append(el('div', 'quiz-actions', [install, again]));
    return card;
  };

  render();
}

const root = document.querySelector('#quiz');
if (root) initQuiz(root);
