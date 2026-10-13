const mock = () => globalThis.__uiDesignApiTest;
exports.readUiDesignState = async () => {
  mock().reads++;
  if (mock().error) throw mock().error;
  return mock().result.state;
};
exports.mutateUiDesign = async () => {
  mock().writes++;
  if (mock().error) throw mock().error;
  return mock().result;
};
exports.readPublishedUiDesign = async () => {
  const state = await exports.readUiDesignState();
  return { recipe: state.published, revision: state.publishedRevision, updatedAt: state.publishedAt };
};
