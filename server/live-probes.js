import { draftManualProbe } from "./manual-probe.js";

export function pitchProbes() {
  return ["无聊程度", "信息量程度"].map((name, index) => {
    const option = draftManualProbe(name).options[0];
    return { id: `pitch-${index}`, input: name, name: option.name, description: option.description,
      criterion: option.criterion, positive: option.positive, middle: option.middle, negative: option.negative,
      primitive: "score", criteria: [option.negative, option.middle, option.positive],
      color: index ? "#ffad78" : "#72d8d2", revision: 1, enabled: true };
  });
}
