// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IPreInteractionRFQ.sol";
import "../OrderLib.sol";


contract HashChecker is IPreInteractionRFQ, Ownable {
    using OrderLib for OrderLib.OrderRFQ;

    error IncorrectOrderHash();

    bytes32 public immutable limitOrderProtocolDomainSeparator;
    mapping(bytes32 => bool) public hashes;

    constructor (address limitOrderProtocol) {
        // solhint-disable-next-line avoid-low-level-calls
        (, bytes memory data) = limitOrderProtocol.call(abi.encodeWithSignature("DOMAIN_SEPARATOR()"));
        limitOrderProtocolDomainSeparator = abi.decode(data, (bytes32));
    }

    function setHashOrderStatus(OrderLib.OrderRFQ calldata order, bool status) external onlyOwner {
        bytes32 orderHash = order.hash(limitOrderProtocolDomainSeparator);
        hashes[orderHash] = status;
    }

    function preInteractionRFQ(
        OrderLib.OrderRFQ calldata order,
        bytes32 orderHash,
        address taker,
        uint256 makingAmount,
        uint256 takingAmount,
        bytes calldata extraData
    ) external override {
        if (hashes[orderHash] == false) revert IncorrectOrderHash();

        if (extraData.length != 0) {
            IPreInteractionRFQ(address(bytes20(extraData))).preInteractionRFQ(
                order,
                orderHash,
                taker,
                makingAmount,
                takingAmount,
                extraData[20:]
            );
        }
    }
}
