<?php
namespace OCA\ChristianCloud\Controller;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\IRequest;
use OCP\IUserSession;
use OCP\Util;
class PageController extends Controller {
    public function __construct(IRequest $request, private IUserSession $session) { parent::__construct('christiancloud', $request); }
    #[NoAdminRequired]
    #[NoCSRFRequired]
    public function index(): TemplateResponse {
        Util::addStyle('christiancloud', 'cloud');
        Util::addScript('christiancloud', 'cloud');
        return new TemplateResponse('christiancloud', 'index', ['uid' => $this->session->getUser()->getUID()], 'empty');
    }
}
