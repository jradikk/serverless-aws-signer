exports.getProfileParamByName = async (profileName, param, serverless) => {
    
    const profileDescription = await serverless.providers.aws.request('Signer', 'getSigningProfile', {profileName: profileName})
    return  profileDescription[param]

}