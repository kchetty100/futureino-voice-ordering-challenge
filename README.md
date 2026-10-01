# Futureino — Voice Ordering Challenge

Thanks for taking this on. It's an open-ended product task. We'll judge more than whether it runs:

- the UI you design;
- the logic behind how you built it;
- the decisions you make along the way.

There's no single right answer.

## About us

Futureino makes smart vending machines: coffee, snacks, drinks, cotton candy and more. Each machine
has a touchscreen and takes cashless payments.

- Company site: https://futureino.ai
- Machine catalogue: https://futureino.ai/vending-machines

## The idea

A customer walks up to a vending machine and **talks to it**. They ask questions, get advice, and
**complete an order by voice**, while the screen follows the conversation.

Build a working MVP of this for **two machines**. Payment itself is out of scope: the flow should
end at the point where the customer would pay.

| Folder in `images/` | Machine | Learn more |
|---|---|---|
| `coffee` | Boost Coffee: every drink comes hot, iced or at room temperature | https://futureino.ai/vending-machines/coffee-vending-machine |
| `snacks` | Snacks Bot: packaged snacks | https://futureino.ai/vending-machines |

## What's in this pack

```
brand/     Futureino logo files
images/    product images for each machine
```

- **Images only.** We don't provide product names, prices or descriptions. Building the product data
  is part of the task.
- **UI direction** is yours. Using the Futureino logo is recommended.

## The real world this has to survive

A demo that works at a quiet desk is the easy part. The machines stand in malls, gyms, offices and
event halls. Your MVP should hold up there, and we'll test it that way.

- **Noise.** It's loud, and people nearby talk to each other, not to the machine.
- **People are unpredictable.**
  - Customers change their minds, go quiet, or walk away mid-conversation.
  - They ask vague questions ("something sweet but not too heavy?").
  - They ask for things the machine doesn't carry.
- **Languages.** Not every customer speaks English.
- **Trust.**
  - The machine must never order something the customer didn't clearly agree to.
  - It must never offer a product it doesn't have.
  - It must never invent facts, allergens especially. If it doesn't know, it should say so.
- **Complete orders.** An order has to be complete before it moves on. A coffee without a
  temperature isn't an order.
- **Screen and voice agree.** What the machine talks about is what the customer sees.
- **Speed.** It should feel responsive. Long silences kill the experience.
- **The operator's view.** We need a way to review past conversations. We also want to know what a
  conversation costs to run.

How you meet these is up to you. Where you trade one off against another, tell us why.

## How you build it

Language, framework, hosting, services and architecture are all your choice.

**Services and keys.** If you need access to a paid service or API you don't already have, email
**meir@sweetrobo.com** to request a key. Include:

- which service;
- what you'll use it for;
- your expected usage.

Keys we issue are for this challenge only. Don't commit them to a repository or share them.

**AI tools.** Use any AI tools you like. We encourage it. Tell us which ones you used and how.
We'll ask you to explain and change your own code live, so make sure you understand all of it.

If you have your own AI tool subscription with usage available, please use that first. If you don't
have access to an AI coding tool, or you run out, email **meir@sweetrobo.com** as early
as you can. Include a phone number we can call you on. We'll call and get you logged into a Claude
account for this challenge. That account is for this challenge only: don't use it for anything
else.

## Requirements

1. **Deployed and working.** Send us a URL we can open and use on a laptop and on a phone.
2. **Secured.**
   - The deployed app must not be open to the public or scrapeable.
   - No secret key may be exposed to the browser.
   - Nobody should be able to hijack your credentials or run up usage through your deployment.
   - Tell us how we get access, and describe the measures you took.
3. **Source code.** Share a repository link or an archive with us. Keep the commit history: we read
   it.
4. **A decision log**, written as you go, not at the end. For each notable choice, record:
   - what you decided;
   - the alternatives you considered;
   - why you chose it;
   - what you'd revisit.

   Include what didn't work and how you found out.
5. **A short write-up** covering:
   - how to run it and how it's deployed;
   - what a conversation costs, roughly;
   - known limitations;
   - what you'd do next with more time.
6. **A live review.** Afterwards we'll meet with you. You'll walk us through it, we'll try to break
   it, and we'll ask for a change live.

## What we'll look at

- **The UI:** how it looks, and how it feels to use by voice at a machine.
- **The logic:** how the conversation, the screen and the order stay correct under pressure.
- **Your decisions:** what you chose to build, what you chose not to, and the reasoning in your log.
- **Security** of the deployment.
- **Code quality**, commit history, and clarity of the write-up.
- **Communication** along the way, including how and when you ask us for things.

Questions are welcome at **meir@sweetrobo.com**. Good luck, and have fun with it.
