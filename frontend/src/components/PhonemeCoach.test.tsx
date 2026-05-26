import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi, afterEach } from "vitest";
import { MouthVisualizer } from "./MouthVisualizer";
import { PhonemeCoachCard } from "./PhonemeCoachCard";
import { PhonemeCoachModal } from "./PhonemeCoachModal";
import { PHONEME_GUIDES } from "./PhonemeGuideData";

describe("Phoneme Coach Components", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("MouthVisualizer", () => {
    test("renders the anatomical vocal tract chassis", () => {
      const { container } = render(
        <MouthVisualizer
          phoneme="ey"
          type="diphthong"
          voiced={true}
          tonguePosition="diphthong-ey"
          mouthOpening="medium"
          velum="closed"
        />
      );

      // Verify SVG renders
      const svg = container.querySelector("svg");
      expect(svg).toBeTruthy();
      expect(svg?.getAttribute("viewBox")).toBe("0 0 200 200");

      // Verify anatomical parts are present
      expect(container.querySelector(".chassis-upper")).toBeTruthy();
      expect(container.querySelector(".tongue-primary")).toBeTruthy();
      expect(container.querySelector(".tongue-secondary")).toBeTruthy(); // present for diphthongs
      expect(container.querySelector(".airflow-line")).toBeTruthy();
    });

    test("renders single tongue contour and hides secondary for non-diphthongs", () => {
      const { container } = render(
        <MouthVisualizer
          phoneme="m"
          type="nasal"
          voiced={true}
          tonguePosition="neutral"
          mouthOpening="closed"
          velum="open"
        />
      );

      expect(container.querySelector(".tongue-primary")).toBeTruthy();
      expect(container.querySelector(".tongue-secondary")).toBeNull(); // null for monophthongs/consonants
    });

    test("hides animated airflow when airflow display is disabled", () => {
      const { container } = render(
        <MouthVisualizer
          phoneme="ey"
          type="diphthong"
          voiced={true}
          tonguePosition="diphthong-ey"
          mouthOpening="medium"
          velum="closed"
          showAirflow={false}
        />
      );

      expect(container.querySelector(".airflow-line")).toBeNull();
    });
  });

  describe("PhonemeCoachCard", () => {
    test("renders the detailed guide text and lists practice words", () => {
      render(<PhonemeCoachCard phoneme="ey" />);

      // Verify title category matches diphthong
      expect(screen.getByText("Diphthong Vowel (前合双元音)")).toBeTruthy();
      
      // Verify guide word is present
      expect(screen.getByText("/day/")).toBeTruthy();

      // Verify billingual description details
      expect(screen.getByText(/双元音。发音时先发/)).toBeTruthy();

      // Verify practice words are rendered
      expect(screen.getAllByText("main").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("pain").length).toBeGreaterThanOrEqual(1);
    });

    test("renders a usable main vs men listening trainer", () => {
      const onPlayWord = vi.fn();
      const onDrill = vi.fn();

      render(<PhonemeCoachCard phoneme="eɪ" onDrill={onDrill} onPlayWord={onPlayWord} />);

      fireEvent.click(screen.getByRole("button", { name: "Play challenge" }));
      expect(onPlayWord).toHaveBeenCalledWith("main");

      fireEvent.click(screen.getByRole("button", { name: "Choose main" }));
      expect(screen.getByText("Correct. You heard main.")).toBeTruthy();
      expect(screen.getByText("1 / 1")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Drill main" }));
      expect(onDrill).toHaveBeenCalledWith("main");
    });

    test("counts only one answer per listening challenge", () => {
      render(<PhonemeCoachCard phoneme="eɪ" onPlayWord={vi.fn()} />);

      const mainChoice = screen.getByRole("button", { name: "Choose main" });
      fireEvent.click(mainChoice);
      fireEvent.click(mainChoice);

      expect(screen.getByText("1 / 1")).toBeTruthy();
    });

    test("falls back gracefully for unknown phoneme symbols", () => {
      render(<PhonemeCoachCard phoneme="xyz_unknown" />);

      // Verify that it constructs a graceful fallback name containing the symbol
      expect(screen.getAllByText(/xyz_unknown/).length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("PhonemeCoachModal", () => {
    test("renders when phoneme is provided, calling onClose when X button clicked", () => {
      const onClose = vi.fn();
      const onDrill = vi.fn();

      const { rerender } = render(
        <PhonemeCoachModal phoneme={null} onClose={onClose} onDrill={onDrill} />
      );

      // Verify that modal renders nothing if phoneme is null
      expect(screen.queryByRole("dialog")).toBeNull();

      rerender(<PhonemeCoachModal phoneme="ey" onClose={onClose} onDrill={onDrill} />);

      // Verify modal is open
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(screen.getByText("Phoneme Pronunciation Coach")).toBeTruthy();

      // Verify close trigger
      const closeBtn = screen.getByLabelText("Close pronunciation coach");
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("Phoneme guide data", () => {
    test("includes a concrete short-e guide for main vs men contrast work", () => {
      expect(PHONEME_GUIDES["ɛ"].practiceWords).toContain("men");
      expect(PHONEME_GUIDES["ɛ"].minimalPairs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ word1: "men", word2: "main" }),
        ])
      );
      expect(PHONEME_GUIDES.eh).toBe(PHONEME_GUIDES["ɛ"]);
    });

    test("maps common Azure r-colored symbols to concrete guides", () => {
      expect(PHONEME_GUIDES["ɹ"]).toBe(PHONEME_GUIDES.r);
      expect(PHONEME_GUIDES["ɝ"].practiceWords).toContain("girl");
      expect(PHONEME_GUIDES["ɚ"]).toBe(PHONEME_GUIDES["ɝ"]);
    });

    test("covers observed practice-history phonemes with concrete pronunciation guides", () => {
      const observedPhonemes = [
        "t",
        "n",
        "ɪ",
        "s",
        "ə",
        "d",
        "l",
        "i",
        "k",
        "m",
        "w",
        "ɛ",
        "aɪ",
        "z",
        "ð",
        "ʌ",
        "ɹ",
        "eɪ",
        "æ",
        "p",
        "b",
        "ŋ",
        "ɔ",
        "v",
        "f",
        "u",
        "h",
        "ɑ",
        "oʊ",
        "ɚ",
        "g",
        "ʃ",
        "dʒ",
        "aʊ",
        "ɝ",
        "θ",
        "ɔɹ",
        "tʃ",
        "ju",
        "ɑɹ",
        "ɛɹ",
        "ʊ",
        "j",
        "ɪɹ",
        "aʊɹ",
      ];

      for (const phoneme of observedPhonemes) {
        const guide = PHONEME_GUIDES[phoneme];
        expect(guide, `${phoneme} should have a guide`).toBeDefined();
        expect(guide.descriptionCn, `${phoneme} should not use fallback CN copy`).not.toMatch(
          /正在收录|收录中/
        );
        expect(guide.descriptionEn, `${phoneme} should not use fallback EN copy`).not.toMatch(
          /being compiled/
        );
        expect(guide.practiceWords.length, `${phoneme} practice words`).toBeGreaterThan(1);
        expect(guide.minimalPairs.length, `${phoneme} minimal pairs`).toBeGreaterThan(0);
      }
    });
  });
});
