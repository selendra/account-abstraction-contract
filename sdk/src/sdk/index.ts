import { ethers } from "ethers";
import {NetworkConfig, UserOperationInterface, getNetworkConfig } from "../constants";
import { Exception } from "../errorHandler";
import { WalletProviderLike } from "../wallet";
import { AccountFactory, getEntryPoint, Account } from "../constants/contract";

export class SDK {
  readonly networkConfig: NetworkConfig
  readonly walletProvider: WalletProviderLike;
  public userOps: UserOperationInterface = {
    sender: "0x0",
    nonce: "0x0",
    initCode: "0x0",
    callData: "0x0",
    paymasterAndData: "0x0",
    signature: "0x0",
    callGasLimit: "0x0",
    verificationGasLimit: "0x0",
    preVerificationGas: "0x0",
    maxFeePerGas: "0x0",
    maxPriorityFeePerGas: "0x0"
  }


  constructor(
    walletProvider: WalletProviderLike,
    chainId: number,
  ) {
    this.walletProvider = walletProvider;

    const networkConfig = getNetworkConfig(chainId);
    if (!networkConfig) throw new Exception("network not found");
    this.networkConfig = networkConfig
  }

  provider() {
    return new ethers.JsonRpcProvider(this.networkConfig.provider);
  }

  bundler() {
    return new ethers.JsonRpcProvider(this.networkConfig.bundler);
  }

  wallet() {
    return new ethers.Wallet(this.walletProvider.wallet?.privateKey || '', this.provider());
  }

  entryPoint() {
    return getEntryPoint(this.networkConfig.contracts.entryPoint, this.wallet())
  }

  async getInitCode() {
    let initCode =
      this.networkConfig.contracts.walletFactory.simpleAccount +
      AccountFactory.interface
        .encodeFunctionData("createAccount", [this.walletProvider.address])
        .slice(2);

    try {
      await this.entryPoint().getSenderAddress(initCode)
    } catch (ex: any) {
      this.userOps.sender = "0x" + ex.data.slice(-40);
    }
    
    const senderIsDeploy = await this.provider().getCode(this.userOps.sender);
    if (senderIsDeploy !== "0x") {
      initCode = "0x";
    }

    this.userOps.initCode = initCode
  }

  async getNonce() {
    this.userOps.nonce = "0x" + (await this.entryPoint().getNonce(this.userOps.sender, 0)).toString(16)
  }

  async getcallData(call: string) {
    this.userOps.callData = Account.interface.encodeFunctionData(call)
  }

  async getSignature() {
    this.userOps.signature = "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c"
  }

  async getpaymasterAndData() {
    this.userOps.paymasterAndData = this.networkConfig.contracts.paymentmaster || "";
  }

  async processUserOps() {
    await this.getInitCode();
    await this.getNonce();
    await this.getSignature();
    await this.getcallData("increment");
    await this.getpaymasterAndData();
  }

  async getEstimateUserOperationGas() {
    
    const { preVerificationGas, verificationGasLimit, callGasLimit } =
    await this.bundler().send("eth_estimateUserOperationGas", [
      this.userOps,
      this.networkConfig.contracts.entryPoint,
    ]);

    this.userOps.callGasLimit = callGasLimit;
    this.userOps.verificationGasLimit = verificationGasLimit;
    this.userOps.preVerificationGas = preVerificationGas;
    
    const { maxFeePerGas, maxPriorityFeePerGas } = await this.provider().getFeeData();

    this.userOps.maxFeePerGas = "0x" + maxFeePerGas?.toString(16);
    this.userOps.maxPriorityFeePerGas = "0x" + maxPriorityFeePerGas?.toString(16);

    const userOpHash = await this.entryPoint().getUserOpHash(this.userOps);
    this.userOps.signature = (await (this.walletProvider.signMessage(ethers.getBytes(userOpHash)))).toString();
  }

  async getUserOperationByHash() {
    await this.processUserOps()
    await this.getEstimateUserOperationGas()

    const opHash = await this.bundler().send("eth_sendUserOperation", [
      this.userOps,
      this.networkConfig.contracts.entryPoint,
    ]);
  
    setTimeout(async () => {
      const { transactionHash } = await this.bundler().send(
        "eth_getUserOperationByHash",
        [opHash]
      );
  
      console.log(transactionHash);
    }, 8000);
  }
}
