// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SavingsCircles is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum CircleState {
        Pending,
        Active,
        Finished
    }

    struct Reputation {
        uint256 completedCircles;
        uint256 onTimePayments;
        uint256 missedPayments;
        uint256 defaults;
    }

    struct ShortfallEntry {
        address creditor;
        uint256 amount;
    }

    struct Circle {
        uint256 contribution;
        uint64 roundLength;
        uint8 size;
        uint8 depositRounds;
        address[] members;
        uint8 currentRound;
        uint64 deadline;
        CircleState state;
        mapping(uint8 => mapping(address => bool)) paid;
        mapping(address => uint256) deposit;
        mapping(uint8 => uint8) missCount;
        mapping(address => bool) isMember;
        mapping(address => bool) defaultedInCircle;
        // Per member: total USDC they have shorted other recipients across all rounds in this circle.
        mapping(address => uint256) shortfallOwed;
        // Ordered list of shortfall creditors per debtor.
        mapping(address => ShortfallEntry[]) shortfallQueue;
    }

    IERC20 public immutable usdc;

    uint256 public nextCircleId;

    mapping(uint256 => Circle) private circles;
    mapping(address => Reputation) public reputation;
    mapping(address => uint256) public claimable;

    event CircleCreated(
        uint256 indexed id,
        address indexed creator,
        uint256 contribution,
        uint64 roundLength,
        uint8 size,
        uint8 depositRounds
    );
    event Joined(uint256 indexed id, address indexed member, uint256 memberCount);
    event CircleStarted(uint256 indexed id, uint64 deadline);
    event Contributed(uint256 indexed id, address indexed member, uint8 round);
    event Missed(uint256 indexed id, address indexed member, uint8 round);
    event Defaulted(uint256 indexed id, address indexed member, uint8 round);
    event RoundClosed(uint256 indexed id, uint8 round, address indexed recipient, uint256 amount);
    event CircleFinished(uint256 indexed id);
    event Repaid(uint256 indexed id, address indexed debtor, address indexed creditor, uint256 amount);
    event Withdrawn(address indexed member, uint256 amount);

    error InvalidUSDC();
    error InvalidContribution();
    error InvalidRoundLength();
    error InvalidSize();
    error InvalidDepositRounds();
    error CircleNotFound();
    error InvalidState();
    error AlreadyMember();
    error NotMember();
    error AlreadyPaid();
    error RoundClosedAlready();
    error RoundStillOpen();
    error NothingToWithdraw();

    constructor(address usdc_) {
        if (usdc_ == address(0)) revert InvalidUSDC();
        usdc = IERC20(usdc_);
    }

    function createCircle(
        uint256 contribution,
        uint64 roundLength,
        uint8 size,
        uint8 depositRounds
    ) external nonReentrant returns (uint256 id) {
        if (contribution == 0) revert InvalidContribution();
        if (roundLength == 0) revert InvalidRoundLength();
        if (size < 2 || size > 20) revert InvalidSize();
        if (depositRounds < 1 || depositRounds > size - 1) revert InvalidDepositRounds();

        id = nextCircleId;
        unchecked {
            nextCircleId = id + 1;
        }

        Circle storage circle = circles[id];
        circle.contribution = contribution;
        circle.roundLength = roundLength;
        circle.size = size;
        circle.depositRounds = depositRounds;
        circle.state = CircleState.Pending;

        emit CircleCreated(id, msg.sender, contribution, roundLength, size, depositRounds);
    }

    function join(uint256 id) external nonReentrant {
        _requireCircleExists(id);
        Circle storage circle = circles[id];

        if (circle.state != CircleState.Pending) revert InvalidState();
        if (circle.isMember[msg.sender]) revert AlreadyMember();

        circle.isMember[msg.sender] = true;
        circle.members.push(msg.sender);
        circle.deposit[msg.sender] = circle.contribution * circle.depositRounds;

        usdc.safeTransferFrom(msg.sender, address(this), circle.contribution * circle.depositRounds);

        emit Joined(id, msg.sender, circle.members.length);

        if (circle.members.length == circle.size) {
            circle.state = CircleState.Active;
            circle.currentRound = 0;
            circle.deadline = uint64(block.timestamp) + circle.roundLength;

            emit CircleStarted(id, circle.deadline);
        }
    }

    function contribute(uint256 id) external nonReentrant {
        _requireCircleExists(id);
        Circle storage circle = circles[id];

        if (circle.state != CircleState.Active) revert InvalidState();
        if (!circle.isMember[msg.sender]) revert NotMember();
        if (circle.paid[circle.currentRound][msg.sender]) revert AlreadyPaid();
        if (block.timestamp >= circle.deadline) revert RoundClosedAlready();

        circle.paid[circle.currentRound][msg.sender] = true;
        reputation[msg.sender].onTimePayments += 1;

        usdc.safeTransferFrom(msg.sender, address(this), circle.contribution);

        emit Contributed(id, msg.sender, circle.currentRound);
    }

    function closeRound(uint256 id) external nonReentrant {
        _requireCircleExists(id);
        Circle storage circle = circles[id];

        if (circle.state != CircleState.Active) revert InvalidState();
        if (block.timestamp < circle.deadline) revert RoundStillOpen();

        uint8 round = circle.currentRound;
        uint256 contribution = circle.contribution;
        uint256 pot;
        uint8 missedInRound;
        address recipient = circle.members[round];

        uint256 memberCount = circle.members.length;
        for (uint256 i = 0; i < memberCount; ++i) {
            address member = circle.members[i];

            if (circle.paid[round][member]) {
                pot += contribution;
                continue;
            }

            missedInRound += 1;
            reputation[member].missedPayments += 1;

            if (member == recipient) {
                emit Missed(id, member, round);
                continue;
            }

            uint256 remainingDeposit = circle.deposit[member];
            if (remainingDeposit >= contribution) {
                circle.deposit[member] = remainingDeposit - contribution;
                pot += contribution;
                emit Missed(id, member, round);
            } else {
                pot += remainingDeposit;
                circle.deposit[member] = 0;

                uint256 shortage = contribution - remainingDeposit;
                if (shortage > 0) {
                    circle.shortfallOwed[member] += shortage;
                    circle.shortfallQueue[member].push(ShortfallEntry({creditor: recipient, amount: shortage}));
                }

                emit Defaulted(id, member, round);

                if (!circle.defaultedInCircle[member]) {
                    circle.defaultedInCircle[member] = true;
                    reputation[member].defaults += 1;
                }
            }
        }

        circle.missCount[round] = missedInRound;

        // Repay outstanding shortfalls from recipient's pot, oldest first
        uint256 remaining = pot;
        ShortfallEntry[] storage queue = circle.shortfallQueue[recipient];
        uint256 qLen = queue.length;
        for (uint256 j = 0; j < qLen && remaining > 0; ++j) {
            ShortfallEntry storage entry = queue[j];
            if (entry.amount == 0) continue;
            uint256 repayAmt = remaining < entry.amount ? remaining : entry.amount;
            entry.amount -= repayAmt;
            circle.shortfallOwed[recipient] -= repayAmt;
            remaining -= repayAmt;
            claimable[entry.creditor] += repayAmt;
            emit Repaid(id, recipient, entry.creditor, repayAmt);
        }
        claimable[recipient] += remaining;

        emit RoundClosed(id, round, recipient, pot);

        if (round + 1 == circle.size) {
            circle.state = CircleState.Finished;

            for (uint256 i = 0; i < memberCount; ++i) {
                address member = circle.members[i];

                uint256 remainingDeposit = circle.deposit[member];
                if (remainingDeposit > 0) {
                    claimable[member] += remainingDeposit;
                    circle.deposit[member] = 0;
                }

                if (!circle.defaultedInCircle[member]) {
                    reputation[member].completedCircles += 1;
                }
            }

            emit CircleFinished(id);
        } else {
            circle.currentRound = round + 1;
            circle.deadline = uint64(block.timestamp) + circle.roundLength;
        }
    }

    function withdraw() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        claimable[msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    function getCircle(
        uint256 id
    )
        external
        view
        returns (
            uint256 contribution,
            uint64 roundLength,
            uint8 size,
            uint8 memberCount,
            uint8 currentRound,
            uint64 deadline,
            CircleState state,
            uint8 depositRounds,
            uint256 potForCurrentRound
        )
    {
        _requireCircleExists(id);
        Circle storage circle = circles[id];

        contribution = circle.contribution;
        roundLength = circle.roundLength;
        size = circle.size;
        memberCount = uint8(circle.members.length);
        currentRound = circle.currentRound;
        deadline = circle.deadline;
        state = circle.state;
        depositRounds = circle.depositRounds;

        if (state == CircleState.Active) {
            uint256 paidCount;
            uint256 len = circle.members.length;
            for (uint256 i = 0; i < len; ++i) {
                if (circle.paid[currentRound][circle.members[i]]) {
                    paidCount += 1;
                }
            }
            potForCurrentRound = paidCount * contribution;
        }
    }

    function getMembers(uint256 id) external view returns (address[] memory) {
        _requireCircleExists(id);
        return circles[id].members;
    }

    function hasPaid(uint256 id, uint8 round, address member) external view returns (bool) {
        _requireCircleExists(id);
        return circles[id].paid[round][member];
    }

    function depositOf(uint256 id, address member) external view returns (uint256) {
        _requireCircleExists(id);
        return circles[id].deposit[member];
    }

    function shortfallOf(uint256 id, address member) external view returns (uint256) {
        _requireCircleExists(id);
        return circles[id].shortfallOwed[member];
    }

    function _requireCircleExists(uint256 id) internal view {
        if (id >= nextCircleId) revert CircleNotFound();
    }
}
