# hmm_program_elective

**Name:** Sreelekshmi Harikumar
**University Reg No:** TCR24CS068

🔗 **Live Website:** [https://hmm-program-elective.vercel.app/](https://hmm-program-elective.vercel.app/)

---

## How to Use the Website

**1. Enter your observation sequence**
Type a space-separated list of numbers into the input box. These are your observed symbols — for example `0 1 2 0 1 2 1 0`. Each number represents a different observation type.

**2. Set your parameters**
- **Hidden states** — how many hidden states you want the model to learn (start with 2)
- **Symbols (M)** — how many distinct values are in your sequence
- **Max iterations** — how many training steps to allow (100 is fine)
- **Seed** — controls the random starting point; try different seeds if results look odd

**3. Click "Run Baum-Welch Algorithm"**
The model trains and all results appear automatically.

---

## Reading the Output

**State Transition Diagram** — Shows the learned model visually. Thicker arrows mean higher probability. Use the ▶ play button to replay the training iteration by iteration and watch the model improve. Click any state circle to see its exact matrix values.

**Log-likelihood chart** — Shows how the model improved each iteration. The line should always go upward.

**γ chart** — Shows which hidden state the model thinks was active at each time step.

**A / B / π tables** — The learned probability matrices. Each row sums to 1.0.

---

## Tips

- If you see all-zero values in the matrices, try a different seed — the model got stuck
- Try the **Load Weather Example** button to see a working example instantly
- Higher max iterations + smaller epsilon gives more precise results
