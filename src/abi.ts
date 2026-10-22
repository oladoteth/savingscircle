export const SAVINGS_CIRCLES_ABI = [
  // ── Events ────────────────────────────────────────────────────────────────
  {
    type: "event", name: "CircleCreated",
    inputs: [
      { name: "id",            type: "uint256", indexed: true  },
      { name: "creator",       type: "address", indexed: true  },
      { name: "contribution",  type: "uint256", indexed: false },
      { name: "periodLength",  type: "uint64",  indexed: false },
      { name: "size",          type: "uint8",   indexed: false },
      { name: "depositPeriods",type: "uint8",   indexed: false },
      { name: "hasInviteList", type: "bool",    indexed: false },
    ],
  },
  {
    type: "event", name: "Joined",
    inputs: [
      { name: "id",          type: "uint256", indexed: true  },
      { name: "member",      type: "address", indexed: true  },
      { name: "memberCount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event", name: "Left",
    inputs: [
      { name: "id",     type: "uint256", indexed: true },
      { name: "member", type: "address", indexed: true },
    ],
  },
  {
    type: "event", name: "Removed",
    inputs: [
      { name: "id",     type: "uint256", indexed: true },
      { name: "member", type: "address", indexed: true },
    ],
  },
  {
    type: "event", name: "ToppedUp",
    inputs: [
      { name: "id",     type: "uint256", indexed: true  },
      { name: "member", type: "address", indexed: true  },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event", name: "CycleStarted",
    inputs: [
      { name: "id",         type: "uint256", indexed: true  },
      { name: "cycle",      type: "uint32",  indexed: false },
      { name: "cycleStart", type: "uint64",  indexed: false },
    ],
  },
  {
    type: "event", name: "Collected",
    inputs: [
      { name: "id",        type: "uint256", indexed: true  },
      { name: "member",    type: "address", indexed: true  },
      { name: "amount",    type: "uint256", indexed: false },
      { name: "lateCount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event", name: "Missed",
    inputs: [
      { name: "id",           type: "uint256", indexed: true  },
      { name: "member",       type: "address", indexed: true  },
      { name: "owedRemaining",type: "uint256", indexed: false },
    ],
  },
  {
    type: "event", name: "PayoutTaken",
    inputs: [
      { name: "id",     type: "uint256", indexed: true  },
      { name: "cycle",  type: "uint32",  indexed: false },
      { name: "member", type: "address", indexed: true  },
      { name: "payout", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event", name: "Defaulted",
    inputs: [
      { name: "id",     type: "uint256", indexed: true },
      { name: "member", type: "address", indexed: true },
    ],
  },
  {
    type: "event", name: "CycleSettled",
    inputs: [
      { name: "id",    type: "uint256", indexed: true  },
      { name: "cycle", type: "uint32",  indexed: false },
    ],
  },
  {
    type: "event", name: "Withdrawn",
    inputs: [
      { name: "member", type: "address", indexed: true  },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },

  // ── Write functions ────────────────────────────────────────────────────────
  {
    type: "function", name: "createCircle", stateMutability: "nonpayable",
    inputs: [
      { name: "contribution",   type: "uint256" },
      { name: "periodLength",   type: "uint64"  },
      { name: "size",           type: "uint8"   },
      { name: "depositPeriods", type: "uint8"   },
      { name: "invited",        type: "address[]" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function", name: "join", stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function", name: "leave", stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function", name: "topUp", stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function", name: "removeUnfunded", stateMutability: "nonpayable",
    inputs: [
      { name: "id",     type: "uint256" },
      { name: "member", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function", name: "startCycle", stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function", name: "collect", stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function", name: "pay", stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function", name: "request", stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function", name: "settleCycle", stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function", name: "withdraw", stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },

  // ── View functions ─────────────────────────────────────────────────────────
  {
    type: "function", name: "getCircle", stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{
      name: "", type: "tuple",
      components: [
        { name: "contribution",   type: "uint256" },
        { name: "periodLength",   type: "uint64"  },
        { name: "size",           type: "uint8"   },
        { name: "depositPeriods", type: "uint8"   },
        { name: "payout",         type: "uint256" },
        { name: "memberCount",    type: "uint256" },
        { name: "state",          type: "uint8"   },
        { name: "cycle",          type: "uint32"  },
        { name: "cycleStart",     type: "uint64"  },
        { name: "settledAt",      type: "uint64"  },
        { name: "currentPeriod",  type: "uint256" },
        { name: "nextDueTime",    type: "uint64"  },
        { name: "pot",            type: "uint256" },
      ],
    }],
  },
  {
    type: "function", name: "memberInfo", stateMutability: "view",
    inputs: [
      { name: "id",     type: "uint256" },
      { name: "member", type: "address" },
    ],
    outputs: [{
      name: "", type: "tuple",
      components: [
        { name: "deposit",        type: "uint256" },
        { name: "paidThisCycle",  type: "uint256" },
        { name: "owedNow",        type: "uint256" },
        { name: "takenThisCycle", type: "bool"    },
        { name: "isMember",       type: "bool"    },
      ],
    }],
  },
  {
    type: "function", name: "getMembers", stateMutability: "view",
    inputs:  [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "function", name: "isInvited", stateMutability: "view",
    inputs: [
      { name: "id",     type: "uint256" },
      { name: "member", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function", name: "claimable", stateMutability: "view",
    inputs:  [{ name: "addr", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function", name: "reputation", stateMutability: "view",
    inputs:  [{ name: "addr", type: "address" }],
    outputs: [
      { name: "cyclesCompleted",  type: "uint256" },
      { name: "onTimePayments",   type: "uint256" },
      { name: "latePayments",     type: "uint256" },
      { name: "missedPayments",   type: "uint256" },
      { name: "defaults",         type: "uint256" },
    ],
  },
  {
    type: "function", name: "nextCircleId", stateMutability: "view",
    inputs:  [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function", name: "usdc", stateMutability: "view",
    inputs:  [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function", name: "getCirclesByMember", stateMutability: "view",
    inputs:  [{ name: "wallet", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function", name: "getCirclesByCreator", stateMutability: "view",
    inputs:  [{ name: "wallet", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
] as const;
