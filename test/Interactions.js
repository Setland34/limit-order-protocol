const { expect } = require('@1inch/solidity-utils');
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { deploySwapTokens } = require('./helpers/fixtures');
const { ethers } = require('hardhat');
const { ether } = require('./helpers/utils');
const { signOrder, buildOrder, buildMakerTraits, buildTakerTraits } = require('./helpers/orderUtils');

describe('Interactions', function () {
    let addr, addr1;
    const abiCoder = ethers.utils.defaultAbiCoder;

    before(async function () {
        [addr, addr1] = await ethers.getSigners();
    });

    async function initContracts () {
        const { dai, weth, swap, chainId } = await deploySwapTokens();

        await dai.mint(addr.address, ether('100'));
        await dai.mint(addr1.address, ether('100'));
        await weth.deposit({ value: ether('1') });
        await weth.connect(addr1).deposit({ value: ether('1') });

        await dai.approve(swap.address, ether('100'));
        await dai.connect(addr1).approve(swap.address, ether('100'));
        await weth.approve(swap.address, ether('1'));
        await weth.connect(addr1).approve(swap.address, ether('1'));

        return { dai, weth, swap, chainId };
    };

    describe('recursive swap', function () {
        async function initContractsWithRecursiveMatcher () {
            const { dai, weth, swap, chainId } = await initContracts();

            const RecursiveMatcher = await ethers.getContractFactory('RecursiveMatcher');
            const matcher = await RecursiveMatcher.deploy();
            await matcher.deployed();

            return { dai, weth, swap, chainId, matcher };
        }

        it('opposite direction recursive swap', async function () {
            const { dai, weth, swap, chainId, matcher } = await loadFixture(initContractsWithRecursiveMatcher);

            const order = buildOrder({
                makerAsset: dai.address,
                takerAsset: weth.address,
                makingAmount: ether('100'),
                takingAmount: ether('0.1'),
                maker: addr.address,
            });

            const backOrder = buildOrder({
                makerAsset: weth.address,
                takerAsset: dai.address,
                makingAmount: ether('0.1'),
                takingAmount: ether('100'),
                maker: addr1.address,
            });

            const signature = await signOrder(order, chainId, swap.address, addr);
            const signatureBackOrder = await signOrder(backOrder, chainId, swap.address, addr1);

            const matchingParams = matcher.address + '01' + abiCoder.encode(
                ['address[]', 'bytes[]'],
                [
                    [
                        weth.address,
                        dai.address,
                    ],
                    [
                        weth.interface.encodeFunctionData('approve', [swap.address, ether('0.1')]),
                        dai.interface.encodeFunctionData('approve', [swap.address, ether('100')]),
                    ],
                ],
            ).substring(2);

            const { r: backOrderR, _vs: backOrderVs } = ethers.utils.splitSignature(signatureBackOrder);
            const takerTraits = buildTakerTraits({
                interaction: matchingParams,
                makingAmount: true,
                minReturn: ether('100'),
            });
            const interaction = matcher.address + '00' + swap.interface.encodeFunctionData('fillOrderArgs', [
                backOrder,
                backOrderR,
                backOrderVs,
                ether('0.1'),
                takerTraits.traits,
                takerTraits.args,
            ]).substring(10);

            const addrweth = await weth.balanceOf(addr.address);
            const addr1weth = await weth.balanceOf(addr1.address);
            const addrdai = await dai.balanceOf(addr.address);
            const addr1dai = await dai.balanceOf(addr1.address);

            const { r, _vs: vs } = ethers.utils.splitSignature(signature);
            const matcherTraits = buildTakerTraits({
                interaction,
                makingAmount: true,
                minReturn: ether('0.1'),
            });
            await matcher.matchOrders(swap.address, order, r, vs, ether('100'), matcherTraits.traits, matcherTraits.args);

            expect(await weth.balanceOf(addr.address)).to.equal(addrweth.add(ether('0.1')));
            expect(await weth.balanceOf(addr1.address)).to.equal(addr1weth.sub(ether('0.1')));
            expect(await dai.balanceOf(addr.address)).to.equal(addrdai.sub(ether('100')));
            expect(await dai.balanceOf(addr1.address)).to.equal(addr1dai.add(ether('100')));
        });

        it('unidirectional recursive swap', async function () {
            const { dai, weth, swap, chainId, matcher } = await loadFixture(initContractsWithRecursiveMatcher);

            const order = buildOrder({
                makerAsset: dai.address,
                takerAsset: weth.address,
                makingAmount: ether('10'),
                takingAmount: ether('0.01'),
                maker: addr1.address,
                makerTraits: buildMakerTraits({ nonce: 0 }),
            });

            const backOrder = buildOrder({
                makerAsset: dai.address,
                takerAsset: weth.address,
                makingAmount: ether('15'),
                takingAmount: ether('0.015'),
                maker: addr1.address,
                makerTraits: buildMakerTraits({ nonce: 0 }),
            });

            const signature = await signOrder(order, chainId, swap.address, addr1);
            const signatureBackOrder = await signOrder(backOrder, chainId, swap.address, addr1);

            const matchingParams = matcher.address + '01' + abiCoder.encode(
                ['address[]', 'bytes[]'],
                [
                    [
                        weth.address,
                        weth.address,
                        dai.address,
                    ],
                    [
                        weth.interface.encodeFunctionData('transferFrom', [addr.address, matcher.address, ether('0.025')]),
                        weth.interface.encodeFunctionData('approve', [swap.address, ether('0.025')]),
                        dai.interface.encodeFunctionData('transfer', [addr.address, ether('25')]),
                    ],
                ],
            ).substring(2);

            const { r: backOrderR, _vs: backOrderVs } = ethers.utils.splitSignature(signatureBackOrder);
            const takerTraits = buildTakerTraits({
                interaction: matchingParams,
                makingAmount: true,
                minReturn: ether('0.015'),
            });
            const interaction = matcher.address + '00' + swap.interface.encodeFunctionData('fillOrderArgs', [
                backOrder,
                backOrderR,
                backOrderVs,
                ether('15'),
                takerTraits.traits,
                takerTraits.args,
            ]).substring(10);

            const addrweth = await weth.balanceOf(addr.address);
            const addr1weth = await weth.balanceOf(addr1.address);
            const addrdai = await dai.balanceOf(addr.address);
            const addr1dai = await dai.balanceOf(addr1.address);

            await weth.approve(matcher.address, ether('0.025'));
            const { r, _vs: vs } = ethers.utils.splitSignature(signature);
            const matcherTraits = buildTakerTraits({
                interaction,
                makingAmount: true,
                minReturn: ether('0.01'),
            });
            await matcher.matchOrders(swap.address, order, r, vs, ether('10'), matcherTraits.traits, matcherTraits.args);

            expect(await weth.balanceOf(addr.address)).to.equal(addrweth.sub(ether('0.025')));
            expect(await weth.balanceOf(addr1.address)).to.equal(addr1weth.add(ether('0.025')));
            expect(await dai.balanceOf(addr.address)).to.equal(addrdai.add(ether('25')));
            expect(await dai.balanceOf(addr1.address)).to.equal(addr1dai.sub(ether('25')));
        });

        it('triple recursive swap', async function () {
            const { dai, weth, swap, chainId, matcher } = await loadFixture(initContractsWithRecursiveMatcher);

            const order1 = buildOrder({
                makerAsset: dai.address,
                takerAsset: weth.address,
                makingAmount: ether('10'),
                takingAmount: ether('0.01'),
                maker: addr1.address,
                makerTraits: buildMakerTraits({ nonce: 0 }),
            });

            const order2 = buildOrder({
                makerAsset: dai.address,
                takerAsset: weth.address,
                makingAmount: ether('15'),
                takingAmount: ether('0.015'),
                maker: addr1.address,
                makerTraits: buildMakerTraits({ nonce: 0 }),
            });

            const backOrder = buildOrder({
                makerAsset: weth.address,
                takerAsset: dai.address,
                makingAmount: ether('0.025'),
                takingAmount: ether('25'),
                maker: addr.address,
                makerTraits: buildMakerTraits({ nonce: 0 }),
            });

            const signature1 = await signOrder(order1, chainId, swap.address, addr1);
            const signature2 = await signOrder(order2, chainId, swap.address, addr1);
            const signatureBackOrder = await signOrder(backOrder, chainId, swap.address, addr);

            const matchingParams = matcher.address + '01' + abiCoder.encode(
                ['address[]', 'bytes[]'],
                [
                    [
                        weth.address,
                        dai.address,
                    ],
                    [
                        weth.interface.encodeFunctionData('approve', [swap.address, ether('0.025')]),
                        dai.interface.encodeFunctionData('approve', [swap.address, ether('25')]),
                    ],
                ],
            ).substring(2);

            const { r: backOrderR, _vs: backOrderVs } = ethers.utils.splitSignature(signatureBackOrder);
            const internalTakerTraits = buildTakerTraits({
                interaction: matchingParams,
                makingAmount: true,
                minReturn: ether('25'),
            });
            const internalInteraction = matcher.address + '00' + swap.interface.encodeFunctionData('fillOrderArgs', [
                backOrder,
                backOrderR,
                backOrderVs,
                ether('0.025'),
                internalTakerTraits.traits,
                internalTakerTraits.args,
            ]).substring(10);

            const { r: order2R, _vs: order2Vs } = ethers.utils.splitSignature(signature2);
            const externalTakerTraits = buildTakerTraits({
                interaction: internalInteraction,
                makingAmount: true,
                minReturn: ether('25'),
            });
            const externalInteraction = matcher.address + '00' + swap.interface.encodeFunctionData('fillOrderArgs', [
                order2,
                order2R,
                order2Vs,
                ether('15'),
                externalTakerTraits.traits,
                externalTakerTraits.args,
            ]).substring(10);

            const addrweth = await weth.balanceOf(addr.address);
            const addr1weth = await weth.balanceOf(addr1.address);
            const addrdai = await dai.balanceOf(addr.address);
            const addr1dai = await dai.balanceOf(addr1.address);

            const { r, _vs: vs } = ethers.utils.splitSignature(signature1);
            const matcherTraits = buildTakerTraits({
                interaction: externalInteraction,
                makingAmount: true,
                minReturn: ether('0.01'),
            });
            await matcher.matchOrders(swap.address, order1, r, vs, ether('10'), matcherTraits.traits, matcherTraits.args);

            expect(await weth.balanceOf(addr.address)).to.equal(addrweth.sub(ether('0.025')));
            expect(await weth.balanceOf(addr1.address)).to.equal(addr1weth.add(ether('0.025')));
            expect(await dai.balanceOf(addr.address)).to.equal(addrdai.add(ether('25')));
            expect(await dai.balanceOf(addr1.address)).to.equal(addr1dai.sub(ether('25')));
        });
    });

    describe('check hash', function () {
        async function initContractsWithHashChecker () {
            const { dai, weth, swap, chainId } = await initContracts();

            const HashChecker = await ethers.getContractFactory('HashChecker');
            const hashChecker = await HashChecker.deploy(swap.address);
            await hashChecker.deployed();

            return { dai, weth, swap, chainId, hashChecker };
        }

        it('should check hash and fill', async function () {
            const { dai, weth, swap, chainId, hashChecker } = await loadFixture(initContractsWithHashChecker);

            const order = buildOrder(
                {
                    makerAsset: dai.address,
                    takerAsset: weth.address,
                    makingAmount: ether('100'),
                    takingAmount: ether('0.1'),
                    maker: addr1.address,
                    makerTraits: buildMakerTraits(),
                },
                {
                    preInteraction: hashChecker.address,
                },
            );
            const signature = await signOrder(order, chainId, swap.address, addr1);

            const makerDai = await dai.balanceOf(addr1.address);
            const takerDai = await dai.balanceOf(addr.address);
            const makerWeth = await weth.balanceOf(addr1.address);
            const takerWeth = await weth.balanceOf(addr.address);

            await hashChecker.setHashOrderStatus(order, true);

            const { r, _vs: vs } = ethers.utils.splitSignature(signature);
            const takerTraits = buildTakerTraits({
                minReturn: ether('0.1'),
                makingAmount: true,
                extension: order.extension,
            });
            await swap.fillOrderArgs(order, r, vs, ether('100'), takerTraits.traits, takerTraits.args);

            expect(await dai.balanceOf(addr1.address)).to.equal(makerDai.sub(ether('100')));
            expect(await dai.balanceOf(addr.address)).to.equal(takerDai.add(ether('100')));
            expect(await weth.balanceOf(addr1.address)).to.equal(makerWeth.add(ether('0.1')));
            expect(await weth.balanceOf(addr.address)).to.equal(takerWeth.sub(ether('0.1')));
        });

        it('should revert transaction when orderHash not equal target', async function () {
            const { dai, weth, swap, chainId, hashChecker } = await loadFixture(initContractsWithHashChecker);

            const order = buildOrder(
                {
                    makerAsset: dai.address,
                    takerAsset: weth.address,
                    makingAmount: ether('100'),
                    takingAmount: ether('0.1'),
                    maker: addr1.address,
                    makerTraits: buildMakerTraits(),
                },
                {
                    preInteraction: hashChecker.address,
                },
            );

            const signature = await signOrder(order, chainId, swap.address, addr1);

            const { r, _vs: vs } = ethers.utils.splitSignature(signature);
            const takerTraits = buildTakerTraits({
                minReturn: ether('0.1'),
                makingAmount: true,
                extension: order.extension,
            });
            await expect(swap.fillOrderArgs(order, r, vs, ether('100'), takerTraits.traits, takerTraits.args))
                .to.be.revertedWithCustomError(hashChecker, 'IncorrectOrderHash');
        });
    });

    describe('order id validation', function () {
        async function initContractsWithIdInvalidator () {
            const { dai, weth, swap, chainId } = await initContracts();

            const OrderIdInvalidator = await ethers.getContractFactory('OrderIdInvalidator');
            const orderIdInvalidator = await OrderIdInvalidator.deploy(swap.address);
            await orderIdInvalidator.deployed();

            return { dai, weth, swap, chainId, orderIdInvalidator };
        }

        it('should execute order with 2 partial fills', async function () {
            const { dai, weth, swap, chainId, orderIdInvalidator } = await loadFixture(initContractsWithIdInvalidator);
            const orderId = 13341n;

            const order = buildOrder(
                {
                    makerAsset: dai.address,
                    takerAsset: weth.address,
                    makingAmount: ether('100'),
                    takingAmount: ether('0.1'),
                    maker: addr.address,
                    makerTraits: buildMakerTraits({ allowMultipleFills: true }),
                },
                {
                    preInteraction: orderIdInvalidator.address + orderId.toString(16).padStart(8, '0'),
                },
            );
            const signature = await signOrder(order, chainId, swap.address, addr);

            const addrweth = await weth.balanceOf(addr.address);
            const addr1weth = await weth.balanceOf(addr1.address);
            const addrdai = await dai.balanceOf(addr.address);
            const addr1dai = await dai.balanceOf(addr1.address);

            const { r, _vs: vs } = ethers.utils.splitSignature(signature);
            const takerTraits = buildTakerTraits({
                minReturn: ether('0.1'),
                makingAmount: true,
                extension: order.extension,
            });
            await swap.connect(addr1).fillOrderArgs(order, r, vs, ether('50'), takerTraits.traits, takerTraits.args);

            expect(await weth.balanceOf(addr.address)).to.equal(addrweth.add(ether('0.05')));
            expect(await weth.balanceOf(addr1.address)).to.equal(addr1weth.sub(ether('0.05')));
            expect(await dai.balanceOf(addr.address)).to.equal(addrdai.sub(ether('50')));
            expect(await dai.balanceOf(addr1.address)).to.equal(addr1dai.add(ether('50')));

            const takerTraits2 = buildTakerTraits({
                minReturn: ether('0.1'),
                makingAmount: true,
                extension: order.extension,
            });
            await swap.connect(addr1).fillOrderArgs(order, r, vs, ether('50'), takerTraits2.traits, takerTraits2.args);

            expect(await weth.balanceOf(addr.address)).to.equal(addrweth.add(ether('0.1')));
            expect(await weth.balanceOf(addr1.address)).to.equal(addr1weth.sub(ether('0.1')));
            expect(await dai.balanceOf(addr.address)).to.equal(addrdai.sub(ether('100')));
            expect(await dai.balanceOf(addr1.address)).to.equal(addr1dai.add(ether('100')));
        });

        it('should fail to execute order with same orderId, but with different orderHash', async function () {
            const { dai, weth, swap, chainId, orderIdInvalidator } = await loadFixture(initContractsWithIdInvalidator);
            const orderId = 13341n;
            const preInteraction = orderIdInvalidator.address + orderId.toString(16).padStart(8, '0');

            const order = buildOrder(
                {
                    makerAsset: dai.address,
                    takerAsset: weth.address,
                    makingAmount: ether('100'),
                    takingAmount: ether('0.1'),
                    maker: addr.address,
                    makerTraits: buildMakerTraits(),
                },
                {
                    preInteraction,
                },
            );

            const partialOrder = buildOrder(
                {
                    makerAsset: dai.address,
                    takerAsset: weth.address,
                    makingAmount: ether('50'),
                    takingAmount: ether('0.05'),
                    maker: addr.address,
                    makerTraits: buildMakerTraits(),
                },
                {
                    preInteraction,
                },
            );

            const signature = await signOrder(order, chainId, swap.address, addr);
            const signaturePartial = await signOrder(partialOrder, chainId, swap.address, addr);

            const addrweth = await weth.balanceOf(addr.address);
            const addr1weth = await weth.balanceOf(addr1.address);
            const addrdai = await dai.balanceOf(addr.address);
            const addr1dai = await dai.balanceOf(addr1.address);

            const { r, _vs: vs } = ethers.utils.splitSignature(signature);
            const takerTraits = buildTakerTraits({
                minReturn: ether('0.1'),
                makingAmount: true,
                extension: order.extension,
            });
            await swap.connect(addr1).fillOrderArgs(order, r, vs, ether('50'), takerTraits.traits, takerTraits.args);

            expect(await weth.balanceOf(addr.address)).to.equal(addrweth.add(ether('0.05')));
            expect(await weth.balanceOf(addr1.address)).to.equal(addr1weth.sub(ether('0.05')));
            expect(await dai.balanceOf(addr.address)).to.equal(addrdai.sub(ether('50')));
            expect(await dai.balanceOf(addr1.address)).to.equal(addr1dai.add(ether('50')));

            const { r: r2, _vs: vs2 } = ethers.utils.splitSignature(signaturePartial);
            const takerTraits2 = buildTakerTraits({
                minReturn: ether('0.1'),
                makingAmount: true,
                extension: order.extension,
            });
            await expect(swap.connect(addr1).fillOrderArgs(partialOrder, r2, vs2, ether('50'), takerTraits2.traits, takerTraits2.args))
                .to.be.revertedWithCustomError(orderIdInvalidator, 'InvalidOrderHash');
        });
    });
});
